from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import random

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


# =============================================================================
# EVALUATION ENDPOINT (Mocked for Frontend Testing)
# =============================================================================

# 1. Define what data we expect from React
class EvalRequest(BaseModel):
    suiteId: int
    models: list[str]

# 2. Create the endpoint React is looking for
@app.post("/api/evaluate")
async def evaluate_models(request: EvalRequest):
    # Simulate the time it takes to ping actual LLMs
    await asyncio.sleep(2)
    
    metrics = []
    
    # Generate mock metrics for each model requested by the frontend
    for i, model_id in enumerate(request.models):
        score = random.randint(60, 100)
        metrics.append({
            "id": model_id, # React uses this to map the colors and labels
            "score": score,
            "latency": random.randint(200, 800),
            "status": "Passed" if score >= 80 else "Review" if score >= 70 else "Failed",
            "reasoning": f"Simulated judge reasoning for {model_id}. The model followed instructions well but struggled slightly with tone." if i % 2 == 0 else f"Excellent adherence to constraints. Delivery was perfectly mapped to the requested persona."
        })
        
    # Return the exact JSON structure React expects
    return {"metrics": metrics}