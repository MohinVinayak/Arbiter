# ARBITER

**LLM Eval Platform** — A professional, high-performance web platform for massively parallel LLM evaluation and telemetry analysis. Arbiter allows engineers and prompt designers to rapidly test prompt configurations against expected outputs, across an array of frontier AI models simultaneously.

##  Key Features

- **Multi-Model Concurrency**: Fire multiple LLM completions at once (Gemini, Groq/LLaMA, GPT-4o-mini, Anthropic).
- **Three-Tier Evaluation Engine**:
  - **Deterministic Checks**: JSON compliance, strict string matching, length validation, RegEx rules.
  - **Semantic Similarity**: Vector-based semantic scoring using `all-MiniLM-L6-v2` via `sentence-transformers`.
  - **LLM-as-a-Judge**: Designate any available model to analytically score and reason over the raw outputs.
- **Dynamic Judge Selector**: Swap your judging model from the UI via a compact drop-up menu.
- **Raw Inference Logging**: Inspect exactly what each model rendered per test case.
- **Suite Management**: Create, edit, and delete test suites with full CRUD backed by PostgreSQL.
- **Run History**: Browse, compare, and revisit past evaluation runs.

##  Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, vanilla CSS, Framer Motion, Recharts |
| Backend | FastAPI, Pydantic, SQLAlchemy ORM |
| Database | PostgreSQL |
| Orchestration | Docker Compose |

##  Quickstart (Docker)

1. Copy `.env.example` to `backend/.env` and populate your API keys:
```env
GROQ_API_KEY=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
GITHUB_TOKEN=...
```

2. Launch:
```bash
docker-compose up --build -d
```

3. Open `http://localhost/` (Nginx) or `http://localhost:5173/` (Vite dev).

##  Local Development

**Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npx vite
```

##  API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/models` | Returns available models based on configured API keys |
| `POST` | `/api/runs/evaluate` | Run evaluation: `{ suiteId, models[], judgeId }` |
| `GET` | `/api/runs` | List past evaluation runs |
| `POST` | `/api/suites` | Create a new test suite |
| `PUT` | `/api/suites/:id` | Update an existing suite |
| `DELETE` | `/api/suites/:id` | Delete a suite |