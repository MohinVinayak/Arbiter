from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routes import suites, runs

# Create all tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="EvalForge API",
    description="AI Quality Platform — Eval, Debug, Experiment, Monitor",
    version="1.0.0"
)

# Allow React frontend to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(suites.router, prefix="/api/suites", tags=["Test Suites"])
app.include_router(runs.router, prefix="/api/runs", tags=["Runs"])

@app.get("/")
def health_check():
    return {"status": "ok", "message": "EvalForge is running"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    # Avoid noisy 404s when browser asks backend for favicon.
    return Response(status_code=204)
