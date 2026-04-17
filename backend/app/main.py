import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

# Internal imports based on your project structure
from app.database import engine, Base
from app.routes import suites, runs, settings
from app.models.settings import AppSettings  # ensures app_settings table registers with Base

# 1. ROBUST ENVIRONMENT LOADING
# We resolve the absolute path to ensure .env is found even if you run from a subfolder
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

print("\n--- Arbiter Startup: API Key Status ---")
keys = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY"]
for key in keys:
    status = "[OK]" if os.getenv(key) else "[MISSING]"
    print(f"{key:20}: {status}")
print("------------------------------------------\n")

# 2. DATABASE INITIALIZATION
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Arbiter API",
    description="Professional LLM Evaluation & Telemetry Backend",
    version="2.0.0"
)

# 3. CORS CONFIGURATION (Vite Default)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4. ATTACH ROUTERS
app.include_router(suites.router, prefix="/api/suites", tags=["Test Suites"])
app.include_router(runs.router, prefix="/api/runs", tags=["Runs"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])

# =============================================================================
# ENDPOINT: MODEL DISCOVERY
# =============================================================================
@app.get("/api/models")
def get_available_models():
    """Returns only the models that have configured API keys."""
    available_models = []
    if os.getenv("GROQ_API_KEY"):
        available_models.extend(["groq/llama-3.1-8b-instant", "groq/llama-3.3-70b-versatile"])
    if os.getenv("GEMINI_API_KEY"):
        available_models.append("google/gemini-2.0-flash")
    if os.getenv("ANTHROPIC_API_KEY"):
        available_models.append("anthropic/claude-3-haiku-20240307")
    if os.getenv("OPENAI_API_KEY") or os.getenv("GITHUB_TOKEN"):
        available_models.append("github/gpt-4o-mini")
    if os.getenv("DEEPSEEK_API_KEY"):
        available_models.extend(["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"])
    if os.getenv("MISTRAL_API_KEY"):
        available_models.extend(["mistral/mistral-large-latest", "mistral/mistral-small-latest"])
    
    # Inject Custom Models from .env
    custom_models = os.getenv("CUSTOM_MODELS")
    if custom_models:
        for m in custom_models.split(","):
            m = m.strip()
            if m and m not in available_models:
                available_models.append(m)
    
    # Fallback to mocks so the UI remains interactive during local dev
    if not available_models:
        available_models = ["mock/alpha-test", "mock/beta-test"]
    return {"models": available_models}

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)