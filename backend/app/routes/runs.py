import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.run import Result, Run
from app.models.test_suite import TestSuite
from app.services.evaluator import (
    compute_overall_score,
    compute_semantic_score,
    run_deterministic_checks,
    run_llm_judge,
)
from app.services.llm_runner import run_parallel

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


# ── Request Schemas ───────────────────────────────────────

class RunCreate(BaseModel):
    suite_id: str
    models: list[str]
    judge_model: Optional[str] = "google/gemini-2.0-flash"


class EvalRequest(BaseModel):
    """Shape the frontend sends to POST /api/runs/evaluate."""
    suiteId: str
    models: list[str]
    judgeId: Optional[str] = "google/gemini-2.0-flash"


# ── Core Evaluation Pipeline ──────────────────────────────

async def _run_eval(suite: TestSuite, models: list[str], judge_model: str, db: Session):
    """
    Full pipeline: LLM calls → 3-layer scoring → DB persist.
    Returns (Run, metrics_list_for_frontend).
    """
    run = Run(suite_id=suite.id, models=models, status="running")
    db.add(run)
    db.commit()
    db.refresh(run)

    # Accumulate per-model stats across all test cases
    accum = {
        m: {
            "scores": [],
            "latencies": [],
            "reasoning": "",
            "tokens": 0,
            "cost": 0.0,
            "outputs": [],
        }
        for m in models
    }

    for test_case in suite.test_cases:
        # Render prompt template
        prompt = test_case.prompt_template
        if test_case.input_variables:
            for k, v in test_case.input_variables.items():
                prompt = prompt.replace(f"{{{k}}}", str(v))

        # Call all models in parallel
        llm_outputs = await run_parallel(models, prompt, db)

        for model, llm_result in llm_outputs.items():
            if isinstance(llm_result, Exception):
                llm_result = {
                    "output": None,
                    "latency_ms": 0,
                    "tokens_used": 0,
                    "cost_usd": 0.0,
                    "error": str(llm_result),
                }

            output = llm_result.get("output")

            det = run_deterministic_checks(output, test_case.checks or [])
            sem = compute_semantic_score(output, test_case.expected_output)
            judge = await run_llm_judge(
                prompt, output, test_case.expected_output,
                judge_model=judge_model, db=db,
            )
            overall = compute_overall_score(det["score"], sem, judge["score"])

            db.add(Result(
                run_id=run.id,
                test_case_id=test_case.id,
                model=model,
                output=output,
                latency_ms=llm_result.get("latency_ms"),
                tokens_used=llm_result.get("tokens_used"),
                cost_usd=llm_result.get("cost_usd"),
                deterministic_score=det["score"],
                semantic_score=sem,
                judge_score=judge["score"],
                overall_score=overall,
                check_details=det["details"],
                judge_reasoning=judge["reasoning"],
                error=llm_result.get("error"),
            ))

            if overall is not None:
                accum[model]["scores"].append(overall)
            if llm_result.get("latency_ms"):
                accum[model]["latencies"].append(llm_result["latency_ms"])
            if judge.get("reasoning"):
                accum[model]["reasoning"] = judge["reasoning"]
            accum[model]["tokens"] += llm_result.get("tokens_used") or 0
            accum[model]["cost"] += llm_result.get("cost_usd") or 0.0
            accum[model]["outputs"].append(output)

    run.status = "completed"
    run.completed_at = datetime.now(timezone.utc)
    db.commit()

    # Build summary metrics (averaged across test cases)
    metrics = []
    for model in models:
        a = accum[model]
        avg_score = (
            round((sum(a["scores"]) / len(a["scores"])) * 100)
            if a["scores"]
            else 0
        )
        avg_latency = (
            round(sum(a["latencies"]) / len(a["latencies"]))
            if a["latencies"]
            else 0
        )
        metrics.append({
            "id": model,
            "score": avg_score,
            "latency": avg_latency,
            "status": "Passed" if avg_score >= 80 else "Review" if avg_score >= 70 else "Failed",
            "reasoning": a["reasoning"] or "No judge output.",
            "outputs": a["outputs"],
            "tokens": a["tokens"],
            "cost": round(a["cost"], 6),
        })

    return run, metrics


# ── Routes ────────────────────────────────────────────────

@router.post("/evaluate")
async def run_evaluate(request: EvalRequest, db: Session = Depends(get_db)):
    """Frontend entry-point. Runs eval synchronously and returns {metrics}."""
    logger.info(
        f"🚀 Starting eval on suite '{request.suiteId}' "
        f"over {len(request.models)} model(s) (Judge: {request.judgeId})"
    )

    suite = db.query(TestSuite).filter(TestSuite.id == request.suiteId).first()
    if not suite:
        raise HTTPException(
            status_code=404,
            detail=f"Suite '{request.suiteId}' not found. Save it to the DB first.",
        )
    if not suite.test_cases:
        raise HTTPException(
            status_code=400,
            detail="This suite has no test cases. Add at least one before running.",
        )

    _, metrics = await _run_eval(suite, request.models, request.judgeId, db)
    logger.info(f"✅ Eval complete. {len(metrics)} model metric summaries ready.")
    return {"metrics": metrics}


@router.post("/")
async def create_run(data: RunCreate, db: Session = Depends(get_db)):
    """Programmatic API — same pipeline, returns run_id + metrics."""
    suite = db.query(TestSuite).filter(TestSuite.id == data.suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    if not suite.test_cases:
        raise HTTPException(status_code=400, detail="Suite has no test cases.")

    run, metrics = await _run_eval(suite, data.models, data.judge_model, db)
    return {"run_id": run.id, "status": run.status, "metrics": metrics}


@router.get("/")
def list_all_runs(db: Session = Depends(get_db)):
    runs = db.query(Run).order_by(Run.created_at.desc()).limit(50).all()
    result = []
    for r in runs:
        suite = db.query(TestSuite).filter(TestSuite.id == r.suite_id).first()
        result.append({
            "id": r.id,
            "suite_name": suite.name if suite else "Unknown",
            "models": r.models,
            "status": r.status,
            "created_at": r.created_at,
            "completed_at": r.completed_at,
        })
    return result


@router.get("/suite/{suite_id}")
def get_runs_for_suite(suite_id: str, db: Session = Depends(get_db)):
    runs = (
        db.query(Run)
        .filter(Run.suite_id == suite_id)
        .order_by(Run.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "models": r.models,
            "status": r.status,
            "created_at": r.created_at,
            "result_count": len(r.results),
        }
        for r in runs
    ]


@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    results = db.query(Result).filter(Result.run_id == run_id).all()
    return {
        "id": run.id,
        "suite_id": run.suite_id,
        "models": run.models,
        "status": run.status,
        "created_at": run.created_at,
        "completed_at": run.completed_at,
        "results": [
            {
                "id": r.id,
                "test_case_id": r.test_case_id,
                "model": r.model,
                "output": r.output,
                "latency_ms": r.latency_ms,
                "tokens_used": r.tokens_used,
                "cost_usd": r.cost_usd,
                "scores": {
                    "deterministic": r.deterministic_score,
                    "semantic": r.semantic_score,
                    "judge": r.judge_score,
                    "overall": r.overall_score,
                },
                "check_details": r.check_details,
                "judge_reasoning": r.judge_reasoning,
                "error": r.error,
            }
            for r in results
        ],
    }
