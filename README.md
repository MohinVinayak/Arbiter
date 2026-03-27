# EvalForge 🔬
### AI Quality Platform — Eval, Debug, Experiment, Monitor

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- Python (3.12+)
- PostgreSQL

### Setup Backend
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Environment Variables:
   Copy `.env.example` to `.env` in the root/backend directory and configure your PostgreSQL connection and API keys (e.g., Gemini API Key).
5. Start the backend server:
   ```bash
   cd app
   uvicorn main:app --reload
   ```

### Setup Frontend
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

---

## Project Structure
```text
evalforge/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Environment config
│   │   ├── database.py          # DB connection
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── routes/              # API Endpoints
│   │   ├── services/            # Business Logic & LLM interactions
│   │   └── utils/               # Helpers
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── pages/               # React Views
    │   ├── components/          # Reusable UI
    │   └── api/                 # Axios clients
    ├── package.json
    └── tailwind.config.js
```

---

## Phase 1 Checklist (Eval Bench Core)
- [ ] FastAPI backend running
- [ ] PostgreSQL connected
- [ ] Create / Read test suites and test cases
- [ ] Run suite against 1 LLM (Gemini)
- [ ] Score outputs (deterministic checks)
- [ ] LLM-as-judge scoring
- [ ] React dashboard showing results
- [ ] Deploy (Railway + Vercel)
