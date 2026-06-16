# ARBITER

**Live Deployment:** [https://arbiter-umber.vercel.app/](https://arbiter-umber.vercel.app/)

**LLM Eval Platform** — A professional, high-performance web platform for massively parallel LLM evaluation and telemetry analysis. Arbiter allows engineers and prompt designers to rapidly test prompt configurations against expected outputs across an array of frontier AI models simultaneously.

## Key Features

- **Multi-Model Concurrency**: Fire multiple LLM completions at once (Gemini, Groq/LLaMA, OpenAI, Anthropic, Deepseek, Mistral, OpenRouter).
- **BYOK (Bring Your Own Key) Security**: Keys are securely stored locally in the browser's `localStorage` and sent over HTTPS only when running an evaluation. They are never written to any server database. Server fallbacks are also supported.
- **Three-Tier Evaluation Engine**:
  - **Deterministic Checks**: JSON compliance, strict string matching, length validation, RegEx rules.
  - **Semantic Similarity**: Vector-based semantic scoring using `all-MiniLM-L6-v2` via `sentence-transformers`.
  - **LLM-as-a-Judge**: Designate any available model to analytically score and reason over the raw outputs.
- **Dynamic Judge Selector**: Swap your judging model from the UI via a compact drop-up menu.
- **Raw Inference Logging**: Inspect exactly what each model rendered per test case.
- **Suite Management**: Create, edit, and delete test suites with full CRUD backed by SQLite (local) or PostgreSQL (production).
- **Run History**: Browse, compare, and revisit past evaluation runs.

## Platform Walkthrough

A visual tour of the Arbiter evaluation platform in action.

### 1. Dashboard Overview
![Dashboard displaying evaluation runs and aggregated metrics](assets/screenshots/dashboard.png)
*The centralized hub for tracking your LLM evaluation suites and viewing macro score correlations.*

### 2. Creating a Test Suite
![Suite creation UI with code inputs and JSON schema toggles](assets/screenshots/ts1.png)

![Suite creation](assets/screenshots/ts2.png)
*Defining precise deterministic evaluation controls (RegEx, length, strict match) for test cases.*

### 3. LLM-as-a-Judge Analysis
![Graphs](assets/screenshots/graphs.png)
![Detailed view of the Judge reasoning pane](assets/screenshots/op.png)
*Leveraging strong reasoning models (like GPT-4o or Llama 3.3 70B) to score and critically evaluate the raw outputs of other models.*

### 4. Raw Inference Tracing
![Codebox showing standard unformatted text outputs next to structured JSON](assets/screenshots/raw_logs.png)
*Inspecting the raw outputs to diagnose why specific models passed or failed semantic similarity thresholds.*

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, vanilla CSS, Framer Motion, Recharts |
| Backend | FastAPI, Pydantic, SQLAlchemy ORM |
| Database | SQLite (Local) / PostgreSQL (Production) |
| Architecture| Vercel (Frontend Hosting) + Railway (Backend/DB) |
| Orchestration | Docker Compose (Local Development) |

## Security & BYOK Architecture

Arbiter is designed with a **Bring Your Own Key** architecture. 
1. Users enter their provider API keys directly into the browser settings UI.
2. Keys are saved in `localStorage`.
3. When an evaluation is triggered, the keys are injected into the HTTP request headers.
4. The backend consumes the headers to authenticate with the providers.
5. **Zero server storage:** API keys are never written to disk or the database.

*Note: For public deployments, the server can still be configured with fallback API keys in `.env` for users who do not provide their own.*

## System Architecture Diagram

```mermaid
flowchart TD

subgraph group_ui["Browser UI"]
  node_frontend_app["App<br/>React shell<br/>[App.jsx]"]
  node_frontend_main["Main<br/>React bootstrap<br/>[main.jsx]"]
  node_frontend_state["Browser state<br/>LocalStorage BYOK<br/>[index.css]"]
  node_frontend_assets["Assets"]
end

subgraph group_api["FastAPI Backend"]
  node_backend_main["API app<br/>FastAPI entry<br/>[main.py]"]
  node_backend_config["Config<br/>[config.py]"]
  node_backend_db[("Database<br/>SQLAlchemy setup<br/>[database.py]")]
  node_routes_runs["Runs routes<br/>API routes<br/>[runs.py]"]
  node_routes_suites["Suites routes<br/>API routes<br/>[suites.py]"]
  node_routes_settings["Settings routes<br/>API routes<br/>[settings.py]"]
  node_service_runner["LLM runner<br/>Inference orchestration<br/>[llm_runner.py]"]
  node_service_eval["Evaluator<br/>Scoring pipeline<br/>[evaluator.py]"]
  node_model_runs[("Run record<br/>Run model<br/>[run.py]")]
  node_model_suites[("Suite model<br/>[test_suite.py]")]
  node_model_settings[("Settings model<br/>App model<br/>[settings.py]")]
  node_utils_keys["Key utils<br/>Key routing<br/>[keys.py]"]
  node_schemas_settings["Settings schema<br/>Pydantic schema<br/>[settings.py]"]
end

subgraph group_external["External Systems"]
  node_provider_apis{{"Model APIs<br/>Provider endpoints"}}
  node_sql_db[("SQLite/Postgres<br/>Persistent store")]
end

node_frontend_main -->|"mounts"| node_frontend_app
node_frontend_app -->|"reads keys"| node_frontend_state
node_frontend_app -->|"suite CRUD"| node_routes_suites
node_frontend_app -->|"settings"| node_routes_settings
node_frontend_app -->|"run history"| node_routes_runs
node_frontend_app -.->|"renders"| node_frontend_assets
node_backend_main -->|"registers"| node_routes_runs
node_backend_main -->|"registers"| node_routes_suites
node_backend_main -->|"registers"| node_routes_settings
node_routes_runs -->|"executes"| node_service_runner
node_routes_runs -->|"persists"| node_model_runs
node_routes_suites -->|"stores"| node_model_suites
node_routes_settings -->|"validates"| node_schemas_settings
node_routes_settings -->|"persists"| node_model_settings
node_service_runner -->|"auth keys"| node_utils_keys
node_service_runner -->|"calls"| node_provider_apis
node_service_runner -->|"hands off"| node_service_eval
node_service_eval -->|"writes results"| node_model_runs
node_backend_db -->|"connects"| node_sql_db
node_model_runs -.->|"via session"| node_backend_db
node_model_suites -.->|"via session"| node_backend_db
node_model_settings -.->|"via session"| node_backend_db

click node_frontend_app "https://github.com/mohinvinayak/arbiter/blob/main/frontend/src/App.jsx"
click node_frontend_main "https://github.com/mohinvinayak/arbiter/blob/main/frontend/src/main.jsx"
click node_frontend_state "https://github.com/mohinvinayak/arbiter/blob/main/frontend/src/index.css"
click node_frontend_assets "https://github.com/mohinvinayak/arbiter/tree/main/frontend/src/assets"
click node_backend_main "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/main.py"
click node_backend_config "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/config.py"
click node_backend_db "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/database.py"
click node_routes_runs "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/routes/runs.py"
click node_routes_suites "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/routes/suites.py"
click node_routes_settings "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/routes/settings.py"
click node_service_runner "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/services/llm_runner.py"
click node_service_eval "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/services/evaluator.py"
click node_model_runs "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/models/run.py"
click node_model_suites "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/models/test_suite.py"
click node_model_settings "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/models/settings.py"
click node_utils_keys "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/utils/keys.py"
click node_schemas_settings "https://github.com/mohinvinayak/arbiter/blob/main/backend/app/schemas/settings.py"

classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a
classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554
classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337
classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81
classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a
class node_frontend_app,node_frontend_main,node_frontend_state,node_frontend_assets toneBlue
class node_backend_main,node_backend_config,node_backend_db,node_routes_runs,node_routes_suites,node_routes_settings,node_service_runner,node_service_eval,node_model_runs,node_model_suites,node_model_settings,node_utils_keys,node_schemas_settings toneAmber
class node_provider_apis,node_sql_db toneMint
```

## Quickstart (Local Docker)

1. Launch the platform:
```bash
docker-compose up --build -d
```

2. Open `http://localhost/` (Nginx) or `http://localhost:5173/` (Vite dev).
3. Open the **Settings** page in the UI to add your API keys.

## Deployment Architecture

Arbiter is designed to be easily deployed to modern serverless and containerized cloud providers.

### Frontend (Vercel)
1. Push the repository to GitHub.
2. Import the `frontend` directory into Vercel as a Vite project.
3. Set the `VITE_API_URL` environment variable to your backend domain (e.g., `https://arbiter-backend.up.railway.app`).

### Backend (Railway)
1. Connect your GitHub repository to Railway.
2. Railway will automatically detect the `railway.json` configuration in the `backend` directory.
3. Provision a PostgreSQL database in Railway and link it to the backend service.
4. The backend will automatically create all necessary tables upon startup.

## Injecting Custom Models

Arbiter natively populates its UI with the best default models for every API key you provide. However, you can inject highly specific, newly-released, or fine-tuned models for server fallback.

Simply add them as a comma-separated list to the `CUSTOM_MODELS` variable in your `backend/.env` file:
```env
CUSTOM_MODELS="mistral/open-mistral-nemo,groq/llama-guard-3-8b,deepseek/deepseek-coder"
```
*Note: Ensure you prefix the model name with the provider (e.g., `mistral/`, `groq/`, `deepseek/`, `google/`, `anthropic/`, `github/`) so the backend knows which API key to route it through.*

## Local Development

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

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/models` | Returns available models based on configured API keys |
| `POST` | `/api/runs/evaluate` | Run evaluation: `{ suiteId, models[], judgeId }` |
| `GET` | `/api/runs` | List past evaluation runs |
| `POST` | `/api/suites` | Create a new test suite |
| `PUT` | `/api/suites/:id` | Update an existing suite |
| `DELETE` | `/api/suites/:id` | Delete a suite |
