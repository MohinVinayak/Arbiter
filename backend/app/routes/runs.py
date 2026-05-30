import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.run import Result, Run
from app.models.test_suite import TestSuite
from app.services.evaluator import (
    compute_overall_score, compute_semantic_score,
    run_deterministic_checks, run_llm_judge,
)
from app.services.llm_runner import run_parallel
from app.utils.keys import get_resolved_keys, get_available_models

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


class RunCreate(BaseModel):
    suite_id: str
    models: list[str]
    judge_model: Optional[str] = "google/gemini-2.0-flash"


class EvalRequest(BaseModel):
    suiteId: str
    models: list[str]
    judgeId: Optional[str] = "google/gemini-2.0-flash"


# ── Core pipeline ─────────────────────────────────────────────────────────

async def _run_eval(suite: TestSuite, models: list[str], judge_model: str,
                    db: Session, resolved: dict):
    run = Run(suite_id=suite.id, models=models, status="running")
    db.add(run)
    db.commit()
    db.refresh(run)

    accum = {m: {"scores": [], "latencies": [], "reasoning": "", "tokens": 0, "cost": 0.0, "outputs": []} for m in models}

    for tc in suite.test_cases:
        prompt = tc.prompt_template
        if tc.input_variables:
            for k, v in tc.input_variables.items():
                prompt = prompt.replace(f"{{{k}}}", str(v))

        llm_outputs = await run_parallel(models, prompt, resolved)

        for model, res in llm_outputs.items():
            if isinstance(res, Exception):
                res = {"output": None, "latency_ms": 0, "tokens_used": 0, "cost_usd": 0.0, "error": str(res)}

            output = res.get("output")
            det    = run_deterministic_checks(output, tc.checks or [])
            sem    = compute_semantic_score(output, tc.expected_output)
            judge  = await run_llm_judge(prompt, output, tc.expected_output, judge_model=judge_model, resolved=resolved)
            overall = compute_overall_score(det["score"], sem, judge["score"])

            db.add(Result(
                run_id=run.id, test_case_id=tc.id, model=model,
                output=output, latency_ms=res.get("latency_ms"),
                tokens_used=res.get("tokens_used"), cost_usd=res.get("cost_usd"),
                deterministic_score=det["score"], semantic_score=sem,
                judge_score=judge["score"], overall_score=overall,
                check_details=det["details"], judge_reasoning=judge["reasoning"],
                error=res.get("error"),
            ))

            if overall is not None: accum[model]["scores"].append(overall)
            if res.get("latency_ms"): accum[model]["latencies"].append(res["latency_ms"])
            if judge.get("reasoning"): accum[model]["reasoning"] = judge["reasoning"]
            accum[model]["tokens"] += res.get("tokens_used") or 0
            accum[model]["cost"]   += res.get("cost_usd")   or 0.0
            accum[model]["outputs"].append(output)

    run.status = "completed"
    run.completed_at = datetime.now(timezone.utc)
    db.commit()

    metrics = []
    for model in models:
        a = accum[model]
        avg = round((sum(a["scores"]) / len(a["scores"])) * 100) if a["scores"] else 0
        lat = round(sum(a["latencies"]) / len(a["latencies"])) if a["latencies"] else 0
        metrics.append({
            "id": model, "score": avg, "latency": lat,
            "status": "Passed" if avg >= 80 else "Review" if avg >= 70 else "Failed",
            "reasoning": a["reasoning"] or "No judge output.",
            "outputs": a["outputs"], "tokens": a["tokens"], "cost": round(a["cost"], 6),
        })

    return run, metrics


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("/evaluate")
async def run_evaluate(request: Request, body: EvalRequest, db: Session = Depends(get_db)):
    resolved = get_resolved_keys(request=request)

    suite = db.query(TestSuite).filter(TestSuite.id == body.suiteId).first()
    if not suite:
        raise HTTPException(404, f"Suite '{body.suiteId}' not found.")
    if not suite.test_cases:
        raise HTTPException(400, "Suite has no test cases.")

    # Validate the requested models are actually available with current keys
    available = get_available_models(resolved)
    bad = [m for m in body.models if m not in available and not m.startswith("mock/")]
    if bad:
        raise HTTPException(400, f"Models not available (key missing?): {bad}")

    _, metrics = await _run_eval(suite, body.models, body.judgeId, db, resolved)
    return {"metrics": metrics}


@router.post("/")
async def create_run(request: Request, data: RunCreate, db: Session = Depends(get_db)):
    resolved = get_resolved_keys(request=request)
    suite = db.query(TestSuite).filter(TestSuite.id == data.suite_id).first()
    if not suite: raise HTTPException(404, "Suite not found")
    if not suite.test_cases: raise HTTPException(400, "Suite has no test cases.")
    run, metrics = await _run_eval(suite, data.models, data.judge_model, db, resolved)
    return {"run_id": run.id, "status": run.status, "metrics": metrics}


@router.get("/")
def list_all_runs(db: Session = Depends(get_db)):
    runs = db.query(Run).order_by(Run.created_at.desc()).limit(50).all()
    return [{"id": r.id, "suite_name": (db.query(TestSuite).filter(TestSuite.id == r.suite_id).first() or type('x', (), {'name': 'Unknown'})()).name,
             "models": r.models, "status": r.status, "created_at": r.created_at, "completed_at": r.completed_at}
            for r in runs]


@router.get("/suite/{suite_id}")
def get_runs_for_suite(suite_id: str, db: Session = Depends(get_db)):
    runs = db.query(Run).filter(Run.suite_id == suite_id).order_by(Run.created_at.desc()).all()
    return [{"id": r.id, "models": r.models, "status": r.status, "created_at": r.created_at, "result_count": len(r.results)} for r in runs]


@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run: raise HTTPException(404, "Run not found")
    results = db.query(Result).filter(Result.run_id == run_id).all()
    return {
        "id": run.id, "suite_id": run.suite_id, "models": run.models,
        "status": run.status, "created_at": run.created_at, "completed_at": run.completed_at,
        "results": [{"id": r.id, "test_case_id": r.test_case_id, "model": r.model,
                     "output": r.output, "latency_ms": r.latency_ms, "tokens_used": r.tokens_used,
                     "cost_usd": r.cost_usd, "scores": {"deterministic": r.deterministic_score,
                     "semantic": r.semantic_score, "judge": r.judge_score, "overall": r.overall_score},
                     "check_details": r.check_details, "judge_reasoning": r.judge_reasoning, "error": r.error}
                    for r in results],
    }
