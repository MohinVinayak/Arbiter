# Arbiter — Interview Cheat Sheet
### Strategy: Lead with WHY, not HOW. Architect first, coder second.

> **Project**: Arbiter — LLM Evaluation Platform  
> **Stack**: React + Vite (Vercel) | FastAPI (Render/Docker) | PostgreSQL (Neon)  
> **Your role**: You designed the architecture, the evaluation pipeline, and the deployment. You used Claude as a pair-programmer to accelerate frontend components and standard CRUD boilerplate — like a senior engineer uses Copilot.  
> **Live**: https://arbiter-umber.vercel.app/

---

## How to Answer Any Question

**Broad question** (architecture, design, tradeoffs) → Go deep. This is your strongest ground.  
**Specific but important** (how scoring works, how async works) → You know these. Answer confidently.  
**Hyper-specific** (exact CSS, line of code, syntax) → Deflect honestly:
> *"I'd check the codebase for the exact syntax — that was one of the parts I had Claude generate while I focused on the backend pipeline. But I can walk you through what it does and why we need it."*

The one sentence to internalize:
> **"I understand the what and the why. The how is in the code, and I know where to find it."*

---

## 1. The 60-Second Pitch (Memorize This)

> *"I built Arbiter, an LLM evaluation platform. The problem it solves: when you're building a product on top of an LLM, you need a systematic way to benchmark models. Arbiter lets you define test suites with prompts and expected outputs, fire them at multiple models simultaneously — GPT-4o, Gemini, Claude, Groq, etc. — and automatically score every response using three layers: deterministic rule checks, semantic similarity via sentence transformer embeddings, and an LLM-as-a-Judge. Results come back with scores, latency, cost, and the judge's reasoning. It's deployed on Vercel and Render with a Neon PostgreSQL backend."*

---

## 2. The Stack — Lead With WHY

Never just name the technology. Always follow with the reason.

| Choice | The WHY |
|---|---|
| **FastAPI** over Django | Django's ORM is synchronous. When you're firing 7+ LLM API calls in parallel per evaluation, you need a non-blocking async event loop. FastAPI is async-first. |
| **PostgreSQL** over MongoDB | The data is inherently relational — suites have test cases, runs have results. SQL gives referential integrity, cascade deletes, and lets you run `AVG(score)` queries natively. MongoDB would lose all of that. |
| **BYOK** over server-stored keys | Never storing a user's API credentials in your database is a fundamental security principle. It eliminates an entire class of breach risk. |
| **Workspace UUID** over full auth | For an MVP evaluation tool, a login system would be scope creep. The UUID pattern achieves the same data isolation with zero infrastructure overhead. It's also a direct stepping stone to JWT if the project needed to scale. |
| **Docker** on Render | Render's free tier doesn't allow custom build/start commands. Docker puts the configuration inside the codebase, bypassing platform restrictions entirely. |
| **asyncio.gather** | Turns O(n × m) sequential API calls into O(1) parallel calls. Without it, evaluating 5 models × 10 test cases = 50 sequential round trips, easily 2-3 minutes. With it, all 50 calls fire simultaneously. |

---

## 3. The Evaluation Pipeline — The Core of the Project

This is the thing that makes Arbiter interesting. Know the WHY for each layer.

```
User triggers run
       ↓
Backend creates Run row (status: "running")
       ↓
asyncio.gather() fires ALL model calls simultaneously
       ↓
For each response → 3-layer scoring
       ↓
Weighted average → stored in DB → status: "completed"
```

### Layer 1 — Deterministic (40% weight)
**What**: Rule-based checks — `must_contain`, `must_not_contain`, `is_json`, `regex_match`, `max_length`.  
**Why**: Cheap, fast, fully reproducible. Perfect for structured output requirements where there's a ground truth.  
**Tradeoff**: Binary. Can't capture nuance — a response that's 90% correct gets the same 0 as one that's completely wrong.

### Layer 2 — Semantic Similarity (30% weight)
**What**: Encode the model's output and the expected output into embeddings using `all-MiniLM-L6-v2`, then compute cosine similarity.  
**Why**: Catches correct answers phrased differently. "The capital is Paris" and "Paris is the capital" score near 1.0 semantically but 0.0 on exact string match.  
**Tradeoff**: Only available when there's an expected output. Embedding quality is limited by the model size.

### Layer 3 — LLM-as-a-Judge (30% weight)
**What**: A designated judge model scores the response 0.0–1.0 and provides reasoning in structured JSON.  
**Why**: Catches hallucinations, off-topic answers, and quality issues that rules and embeddings miss entirely.  
**Tradeoff**: Non-deterministic (judge can vary), expensive (extra API call), and biased toward verbosity and its own outputs. Mitigated by using a *different* model as the judge than the ones being evaluated.

### Score Aggregation
```
final = (0.4 × deterministic) + (0.3 × semantic) + (0.3 × judge)
```
If a layer returns null (e.g., no expected output → no semantic score), the remaining weights re-normalise. The system degrades gracefully instead of crashing.

---

## 4. Key Design Decisions — Tradeoff Answers

These are the questions that separate system thinkers from code monkeys.

**"Why parallel async instead of sequential calls?"**  
> Sequential calls with 5 models × 10 test cases = 50 round trips, each 1-3 seconds. That's up to 2.5 minutes of waiting. Parallel reduces that to the time of the single slowest call — effectively O(1). The tradeoff is error handling complexity: `return_exceptions=True` in `asyncio.gather` means a single failed call doesn't kill the entire evaluation.

**"Why three scoring layers instead of just using the LLM judge for everything?"**  
> Pure LLM judging is non-deterministic, expensive, and biased. Deterministic checks are free and guaranteed reproducible. Semantic similarity is cheap and objective. The three layers create a system where each compensates for the others' weaknesses. It's the same principle as defense in depth in security.

**"Why not build login/authentication?"**  
> For an evaluation tool where users bring their own API keys, a login system would require a user database, password hashing, session management, and token refresh logic — all infrastructure that adds risk without adding value for the core use case. The UUID workspace pattern achieves data isolation with a single DB column and one header. In a real product, you'd swap `X-Workspace-ID` for `Authorization: Bearer <JWT>` and filter by `user_id` — the query pattern is identical.

**"What happens if a model API call fails mid-evaluation?"**  
> Two layers of protection. First, `return_exceptions=True` in `asyncio.gather` means a failed call returns an exception object instead of crashing the gather. Second, the entire evaluation run is wrapped in a `try/finally` block — even if everything fails, the `finally` clause always updates the run status to "failed". This prevents "zombie runs" that stay stuck as "running" forever.

---

## 5. Security — BYOK Explained Simply

The flow in one sentence: **Keys live in the browser, travel as HTTP headers, exist in backend RAM only during the request, and are never written to disk or database.**

1. User types API key into Settings page → saved to **browser localStorage only**
2. On evaluation, frontend reads keys from localStorage → sends as `X-OpenAI-Key`, `X-Gemini-Key` HTTP headers
3. Backend receives headers → uses keys for that request → caches authenticated client objects in RAM (for connection reuse efficiency)
4. Render spins the container down after 15 min of inactivity → all RAM is wiped → keys gone

**The WHY**: Storing credentials in a database creates a single point of breach. If the database is compromised, every user's API key is exposed. BYOK eliminates that risk entirely by making the backend stateless with respect to credentials.

---

## 6. Deployment — The Honest Story

```
GitHub (MohinVinayak/Arbiter)
    ├── /frontend  →  Vercel  (auto-deploy on push)
    └── Dockerfile →  Render  (Docker, free tier)
                         ↓
                  Neon PostgreSQL (free serverless Postgres)
```

**Why this exact combination**: Vercel is the best free frontend host — zero config, instant deploys. Render handles backend containers. Neon provides serverless Postgres without requiring a credit card for a second service.

**The cold start problem**: Render's free tier spins down after 15 min of inactivity. First request wakes it up in ~30s. This is a known, documented tradeoff of free-tier hosting — not a bug.

**The deployment challenge you solved**: Render's free tier restricts custom Build and Start commands. The solution was to put a Dockerfile at the repository root that encapsulates all configuration. The platform just runs the container — no platform-specific settings needed. This also makes the backend portable to any container host (AWS ECS, GCP Cloud Run, Railway) with zero changes.

---

## 7. Weaknesses — Pre-Loaded Answers

Have these ready. Interviewers respect engineers who know their system's limits.

| Weakness | Your Answer |
|---|---|
| No real auth | "Stateless workspace isolation was a deliberate MVP tradeoff. The pattern is a direct stepping stone to JWT — same query structure, just swap the header and filter column." |
| Render cold starts | "Known free-tier limitation. In production you'd use a paid tier or a keep-alive ping strategy. The architecture is cloud-agnostic — the Dockerfile runs anywhere." |
| LLM judge bias | "Judges favor verbose answers and their own outputs. The mitigation built in is using a *different* model as judge than those being evaluated, plus low temperature to reduce variance." |
| No streaming | "Currently results arrive all-at-once after the full evaluation. Streaming via Server-Sent Events would let results appear in real-time — that's the most impactful UX improvement to add next." |

---

## 8. Top 10 Questions — Direct Answers

**Q: Walk me through the project.**  
→ Use Section 1 pitch. Offer to go deeper on any layer.

**Q: Why this tech stack?**  
→ FastAPI for async, PostgreSQL for relational integrity, React because the dashboard is component-heavy. See Section 2 for the full WHY on each choice.

**Q: How does the scoring work?**  
→ Three layers compensating for each other's weaknesses. Deterministic for ground truth, semantic for paraphrasing, LLM judge for quality. 40/30/30 weighted average. Degrades gracefully if a layer returns null.

**Q: How did you handle calling multiple APIs at once?**  
→ `asyncio.gather` fires all calls concurrently. `return_exceptions=True` ensures a single failure doesn't crash the group. Provider differences: Gemini SDK is sync-only, so we wrap it with `asyncio.to_thread`.

**Q: How are API keys secured?**  
→ BYOK. Never stored server-side. localStorage → HTTP headers → volatile RAM only. Container shutdown wipes everything.

**Q: How does multi-user work without logins?**  
→ Browser generates a UUID, sends it as a header, backend filters all DB queries by it. Same isolation as auth, zero infrastructure overhead.

**Q: What was the hardest technical problem?**  
→ Two things: (1) Preventing zombie runs — runs that crash and stay stuck as "running". Solved with `try/finally` always setting status to "failed". (2) Connecting to Neon's PostgreSQL — their connection string includes `?sslmode=require` which the `pg8000` driver doesn't support as a URL parameter. Had to strip it and inject a native Python `ssl_context` object instead.

**Q: What would you improve with more time?**  
→ Real JWT auth, Redis for rate limiting, streaming results via Server-Sent Events, and a prompt versioning system to track how score changes as prompts evolve.

**Q: How did you test it?**  
→ `pytest` with FastAPI's `TestClient`. Covers suite CRUD, empty suite edge cases, and evaluation runs. Uses file-based SQLite for the test DB to avoid thread isolation issues with TestClient.

**Q: Is it live?**  
→ Yes. https://arbiter-umber.vercel.app/ — Backend on Render free tier may take 30s to wake from cold start on first load.

---

## 9. What To Say About AI-Assisted Development

For anything frontend, CRUD routes, or boilerplate:

> *"I designed the system architecture and the evaluation pipeline. For the React components and standard API routes, I used Claude as a pair-programmer to generate the boilerplate — the same way a senior engineer uses GitHub Copilot. That freed me to focus on the complex engineering: the async orchestration, the multi-layer scoring system, the database schema, and getting the deployment pipeline working across Vercel, Render, and Neon."*

This is completely honest, demonstrates AI tool fluency (which companies actively want), and redirects toward your actual strengths.
