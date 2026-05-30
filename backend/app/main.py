import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models.settings import AppSettings   # registers table with Base
from app.models.test_suite import TestSuite, TestCase  # noqa: F401 – ensures tables created
from app.models.run import Run, Result         # noqa: F401 – ensures tables created
from app.routes import runs, settings, suites
from app.utils.keys import get_available_models, get_resolved_keys

# ── Environment ────────────────────────────────────────────────────────────────
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

print("\n--- Arbiter Startup: .env Key Status ---")
_ENV_KEYS = [
    "GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY",
    "OPENROUTER_API_KEY",
]
for key in _ENV_KEYS:
    status = "[OK]" if os.getenv(key) else "[MISSING]"
    print(f"  {key:24}: {status}")
print(f"  DATABASE_URL            : {os.getenv('DATABASE_URL', '(default SQLite)')[:40]}")
print("  NOTE: DB keys (via Settings UI) override .env at request-time.")
print("------------------------------------------\n")

# ── Database initialisation ────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Arbiter API",
    description="Professional LLM Evaluation & Telemetry Backend",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",   # Vite fallback port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(suites.router, prefix="/api/suites", tags=["Test Suites"])
app.include_router(runs.router,   prefix="/api/runs",   tags=["Runs"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])


# ── Model discovery ────────────────────────────────────────────────────────────
@app.get("/api/models")
def list_available_models(request: Request, db: Session = Depends(get_db)):
    """
    Returns models whose provider key is available.
    Priority: user request headers > server .env vars.
    """
    resolved = get_resolved_keys(request=request)
    return {"models": get_available_models(resolved)}


@app.get("/api/health")
def health():
    """Simple liveness probe."""
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)