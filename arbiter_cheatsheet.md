# Arbiter — Interview Cheat Sheet

> **Project**: Arbiter — LLM Evaluation Platform  
> **Stack**: React + Vite (Vercel) | FastAPI (Render/Docker) | PostgreSQL (Neon)  
> **Role**: I designed the system architecture and evaluation pipeline. I used Claude as a pair-programmer to accelerate implementation of the frontend and standard CRUD boilerplate.  
> **Live**: https://arbiter-umber.vercel.app/

---

## 1. The 60-Second Pitch

> *"I built Arbiter, an LLM evaluation platform. The core problem it solves: when you're building a product on top of an LLM, you need a systematic way to compare models. Arbiter lets you define test suites with prompts and expected outputs, fire them at multiple models simultaneously — GPT-4o, Gemini, Claude, Groq, etc. — and automatically score every response using three layers: deterministic rule checks, semantic similarity via sentence transformer embeddings, and an LLM-as-a-Judge. Results come back with scores, latency, cost, and the judge's reasoning, shown in charts. It's deployed on Vercel and Render with a Neon PostgreSQL backend."*

---

## 2. The Stack — and Why

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite | Fast dev experience, component model fits the dashboard UI |
| Backend | FastAPI (Python) | Native async support, auto-generates OpenAPI docs, great for ML-adjacent code |
| Database | PostgreSQL (Neon) | ACID guarantees, relational model fits suites/runs/results naturally |
| Hosting | Vercel + Render | Free tier, git-based auto-deploy, Vercel is instant for static frontends |
| Containerisation | Docker | Bypasses Render's free-tier build command restrictions |

**If asked: Why not Django?**  
FastAPI is async-first. Django's ORM is synchronous. When you're firing 7+ LLM API calls in parallel per evaluation, you need a non-blocking event loop — Django would have required workarounds.

**If asked: Why not MongoDB?**  
The data is relational: a Suite has many TestCases, a Run has many Results, each Result belongs to a TestCase. SQL foreign keys and cascade deletes map to this perfectly. Also, SQL lets you run `AVG(semantic_score)` queries natively.

---

## 3. The Evaluation Pipeline (Most Important Thing)

This is the core of the project. Know it cold.

```
User triggers run
       ↓
Backend creates a Run row (status: "running")
       ↓
asyncio.gather() fires ALL model calls simultaneously
       ↓
For each (model × test_case) response:
    Layer 1 → Deterministic checks
    Layer 2 → Semantic similarity
    Layer 3 → LLM-as-a-Judge
       ↓
Weighted average → final score stored in DB
       ↓
Run status → "completed"
```

### Layer 1 — Deterministic (weight: 40%)
Rule-based checks: `max_length`, `must_contain`, `must_not_contain`, `is_json`, `regex_match`.  
Each check is 0 or 1. Average across all checks = deterministic score.  
**Why**: Fast, cheap, fully reproducible. Ground truth for structured output requirements.

### Layer 2 — Semantic Similarity (weight: 30%)
Model: `all-MiniLM-L6-v2` (sentence-transformers library, runs locally in the backend).  
Encodes the model's actual output and the expected output into 384-dimensional embeddings.  
Computes cosine similarity between the two vectors.  
**Why**: Catches correct answers phrased differently. Pure string matching would miss synonyms and paraphrasing.

### Layer 3 — LLM-as-a-Judge (weight: 30%)
A designated judge model (user selects from UI) receives a structured prompt:
```
Score this response from 0.0 to 1.0 for correctness, relevance, and clarity.
Response: [model's output]
Expected: [expected output]
Return JSON: {"score": float, "reasoning": string}
```
The backend parses the JSON response and stores the score and reasoning.  
**Why**: Catches nuanced quality that rules and embeddings miss, like hallucinations or off-topic answers.

### Score Aggregation
```python
final_score = (0.4 × deterministic) + (0.3 × semantic) + (0.3 × judge)
```
If a layer returns `None` (e.g., no expected output → no semantic score), the weights re-normalise among the layers that did return a score.

---

## 4. Async Orchestration

**The key code pattern:**
```python
tasks = [run_llm(model, case, keys) for model in models for case in test_cases]
results = await asyncio.gather(*tasks, return_exceptions=True)
```

`asyncio.gather` fires ALL tasks concurrently. Instead of waiting 2s per model call sequentially (O(n × m) time), all calls happen in parallel (O(1) time relative to model/case count).

**`return_exceptions=True`**: Critical — if one model's API returns a 429 or 503, the gather doesn't crash. It returns the exception object for that task and continues collecting the other results.

**Provider differences:**
- OpenAI, Groq, DeepSeek, Mistral, OpenRouter → all use OpenAI SDK with different `base_url` (they adopted the OpenAI API spec)
- Anthropic → has its own native async client
- Google Gemini → SDK is synchronous only, so we wrap it with `asyncio.to_thread()` to run it in a thread pool without blocking the event loop

---

## 5. BYOK Security Model

**BYOK = Bring Your Own Key.**

The flow:
1. User enters their API keys on the Settings page
2. Keys are saved to **browser localStorage only** — never sent to the backend for storage
3. When running an evaluation, the frontend reads keys from localStorage and injects them as custom HTTP headers: `X-OpenAI-Key`, `X-Gemini-Key`, etc.
4. The backend extracts these headers per-request, uses them for that request only
5. Keys are temporarily held in **volatile RAM** (cached in `_client_cache` for connection reuse)
6. When Render spins the container down after 15 min of inactivity, all keys in RAM are wiped

**Why this is secure**: Keys are never written to disk, a database, or logs. Volatile RAM is the standard safe way to hold credentials during an active process lifecycle.

**If asked: "What's the risk?"**  
If someone got access to the running process memory (extremely unlikely in a managed PaaS), they could read the keys. The mitigation for production would be a proper secrets manager like AWS Secrets Manager. For this project's threat model (student BYOK tool), it's the right tradeoff.

---

## 6. Multi-Tenancy (Workspace Isolation)

No login system. Instead, a stateless isolation pattern:

1. On first visit, the frontend generates a UUID: `workspace_id = crypto.randomUUID()`
2. Saved to localStorage, sent as `X-Workspace-ID` header on every request
3. Backend filters ALL database queries by this ID:
```python
db.query(TestSuite).filter(TestSuite.workspace_id == workspace_id).all()
```

**Tradeoff**: If you clear localStorage, you "lose" your data. This was a deliberate choice — no need for passwords, no backend auth middleware, and it naturally sandboxes each user's data. The pattern is a stepping stone toward full JWT auth.

---

## 7. Live Model Verification

When the dashboard loads, the frontend calls `GET /api/models`.  
The backend fires a tiny `"hi"` prompt to **every configured model in parallel**.  
Only models that respond successfully are returned to the frontend.  
The result is cached for 5 minutes (TTL cache) to avoid spamming provider APIs.

**Why this matters**: Users only see models in the dropdown that their API keys actually have access to. No more mid-evaluation 401/403 crashes.

---

## 8. Database Schema (4 tables)

```
test_suites
  id (UUID)  name  description  workspace_id  created_at
      |
      | 1:N
      ↓
test_cases
  id  suite_id (FK)  prompt  expected_output  checks (JSON)
      |
      | via runs
      ↓
runs
  id  suite_id (FK)  models (JSON array)  judge_id  status  workspace_id  created_at
      |
      | 1:N
      ↓
results
  id  run_id (FK)  test_case_id (FK)  model_id  actual_output
  deterministic_score  semantic_score  judge_score  final_score
  judge_reasoning  latency_ms  cost_usd  check_results (JSON)
```

**Cascade delete**: Deleting a suite → deletes its test cases, its runs, and those runs' results. Handled by SQLAlchemy FK `ondelete="CASCADE"`.

**UUIDs as strings**: Used instead of integers for portability between SQLite (local dev) and PostgreSQL (production) without needing a migration.

---

## 9. Deployment Architecture

```
GitHub (MohinVinayak/Arbiter)
    ├── /frontend  →  Vercel (auto-deploys on push to main)
    └── /Dockerfile →  Render Web Service (Docker, free tier)
                           ↓
                     Neon PostgreSQL (free serverless Postgres)
```

**Dockerfile at root** (not in `/backend`): Copies `backend/` into the image and runs uvicorn. This was necessary because Render's free tier doesn't allow setting custom Build/Start commands — it only accepts Docker deployments.

**`postgres://` → `postgresql://` rewrite**: Neon injects `postgres://` URLs. SQLAlchemy needs `postgresql://`. `database.py` does a string replace. It also strips the `?sslmode=require` query param (which `pg8000` doesn't support as a URL param) and instead injects a native Python `ssl_context` object.

**Cold starts**: Render's free tier spins down after 15 min of inactivity. First request after that takes ~30s. Known tradeoff for free hosting.

---

## 10. The "I Used Claude" Answer

For any question about specific frontend code, CSS, or CRUD boilerplate:

> *"I designed the system architecture and the evaluation pipeline myself. For the frontend components and the standard CRUD routes, I used Claude as a pair-programmer to generate the boilerplate — similar to how a senior engineer uses GitHub Copilot. It let me focus my engineering time on the complex problems: the async orchestration, the scoring pipeline, the database schema, and the deployment infrastructure."*

This is completely honest, shows AI tool fluency, and redirects the conversation back to the parts you actually deeply understand.

---

## 11. Top 10 Questions You Will Be Asked

**Q: Walk me through your project.**  
→ Use the 60-second pitch in Section 1. Then offer to go deeper on any layer.

**Q: Why did you choose this tech stack?**  
→ See Section 2. FastAPI for async, PostgreSQL for relational data, React for the UI.

**Q: How does the scoring work?**  
→ See Section 3. Three layers: deterministic, semantic, LLM judge. Weighted 40/30/30.

**Q: How did you handle multiple API calls at once?**  
→ See Section 4. `asyncio.gather` with `return_exceptions=True`. All calls fire simultaneously.

**Q: How is security handled for the API keys?**  
→ See Section 5. BYOK — localStorage → HTTP headers → volatile RAM only. Never stored in DB.

**Q: How does multi-user isolation work without a login system?**  
→ See Section 6. Browser-generated UUID sent as a header, used to filter all DB queries.

**Q: What were the biggest technical challenges?**  
→ (1) Preventing "zombie runs" — if a run crashed midway, it stayed stuck as "running". Fixed with `try/finally` that always sets status to "failed" on error. (2) `pg8000` incompatibility with Neon's `sslmode=require` URL param — fixed by stripping the param and injecting a native `ssl_context`.

**Q: What would you improve if you had more time?**  
→ Add real JWT authentication to replace the workspace isolation hack. Add a Redis cache for rate limiting. Support streaming LLM responses so results appear in real-time instead of all at once.

**Q: How did you test it?**  
→ `pytest` with FastAPI's `TestClient`. Tests cover suite CRUD, empty suite handling, and run evaluation. The test DB uses a file-based SQLite (`test.db`) rather than in-memory to avoid connection isolation issues with TestClient.

**Q: Is it deployed? Can I see it?**  
→ Yes. Frontend: https://arbiter-umber.vercel.app/ — The backend on Render's free tier spins down after inactivity so it may take 30s to wake up on first load.

---

## 12. Honest Weaknesses (Have Answers Ready)

| Weakness | Your Answer |
|---|---|
| No real auth | "Stateless workspace isolation was a deliberate MVP tradeoff. The UUID pattern is a direct stepping stone to JWT — swap `X-Workspace-ID` for `Authorization: Bearer` and filter by `user_id` instead." |
| Render cold starts | "Known free-tier limitation. In production, you'd use a paid tier or keep-alive pings. I've written about this tradeoff in the README." |
| LLM-as-a-Judge bias | "Judges tend to favor verbose answers and their own outputs. Mitigation: use a different model as the judge than the ones being evaluated, lower temperature, or use multi-judge consensus." |
| Sentence model accuracy | "MiniLM is fast but not state-of-the-art. Could swap to OpenAI embeddings or a larger model like `e5-large-v2` for better quality at higher cost." |
