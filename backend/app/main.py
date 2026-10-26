import time
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models.test_suite import TestSuite, TestCase  # noqa: F401 - registers tables
from app.models.run import Run, Result                 # noqa: F401 - registers tables
from app.routes import runs, settings, suites
from app.utils.keys import get_available_models, get_resolved_keys
from app.services.llm_runner import run_parallel

# Load environment configuration
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path, override=True)

# Initialize database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Arbiter API",
    description="LLM Evaluation & Telemetry Engine",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(suites.router, prefix="/api/suites", tags=["Test Suites"])
app.include_router(runs.router, prefix="/api/runs", tags=["Runs"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])

# Cache for verified available models (5 min TTL)
_model_cache: dict[str, tuple[float, list]] = {}
_MODEL_CACHE_TTL = 300


@app.get("/api/models")
async def list_available_models(request: Request):
    """Return available models verified with active API keys."""
    resolved = get_resolved_keys(request=request)
    base_models = get_available_models(resolved)

    if not base_models or "mock/alpha-test" in base_models:
        return {"models": base_models}

    cache_key = str(sorted(resolved.items())) + str(sorted(base_models))
    cached = _model_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < _MODEL_CACHE_TTL:
        return {"models": cached[1]}

    results = await run_parallel(base_models, "hi", resolved)
    verified_models = [m for m in base_models if results.get(m) and not results[m].get("error")]

    _model_cache[cache_key] = (time.time(), verified_models)
    return {"models": verified_models}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)
