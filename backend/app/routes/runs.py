from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models.test_suite import TestSuite, TestCase
from app.models.run import Run, Result
from app.services.llm_runner import run_llm, run_parallel
from app.services.evaluator import (
    run_deterministic_checks,
    compute_semantic_score,
    run_llm_judge,
    compute_overall_score
)
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import asyncio

router = APIRouter()

# ── Pydantic Schemas ──────────────────────────────────────

class RunCreate(BaseModel):
    suite_id: str
    models: list[str]  # e.g. ["gemini-pro", "gpt-3.5-turbo"]
    judge_model: Optional[str] = "gemini-2.0-flash"

# ── Background Task ───────────────────────────────────────

async def execute_run(run_id: str, judge_model: str):
    """
    Core eval loop. Runs in background so API returns immediately.
    """
    db = SessionLocal()
    try:
        run = db.query(Run).filter(Run.id == run_id).first()
        if not run:
            return

        run.status = "running"
        db.commit()

        suite = db.query(TestSuite).filter(TestSuite.id == run.suite_id).first()

        for test_case in suite.test_cases:
            # Build final prompt from template + variables
            prompt = test_case.prompt_template
            if test_case.input_variables:
                for key, val in test_case.input_variables.items():
                    prompt = prompt.replace(f"{{{key}}}", str(val))

            # Run prompt against all selected models in parallel
            llm_outputs = await run_parallel(run.models, prompt)

            for model, llm_result in llm_outputs.items():
                output = llm_result.get("output")

                # Layer 1: Deterministic checks
                det = run_deterministic_checks(output, test_case.checks or [])

                # Layer 2: Semantic similarity
                sem_score = compute_semantic_score(output, test_case.expected_output)

                # Layer 3: LLM-as-judge
                judge = await run_llm_judge(prompt, output, test_case.expected_output, judge_model=judge_model)

                # Combined score
                overall = compute_overall_score(
                    det["score"], sem_score, judge["score"]
                )

                result = Result(
                    run_id=run.id,
                    test_case_id=test_case.id,
                    model=model,
                    output=output,
                    latency_ms=llm_result.get("latency_ms"),
                    tokens_used=llm_result.get("tokens_used"),
                    cost_usd=llm_result.get("cost_usd"),
                    deterministic_score=det["score"],
                    semantic_score=sem_score,
                    judge_score=judge["score"],
                    overall_score=overall,
                    check_details=det["details"],
                    judge_reasoning=judge["reasoning"],
                    error=llm_result.get("error")
                )
                db.add(result)

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()

    except Exception as e:
        run = db.query(Run).filter(Run.id == run_id).first()
        if run:
            run.status = "failed"
            db.commit()
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────

@router.post("/")
async def create_run(data: RunCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    suite = db.query(TestSuite).filter(TestSuite.id == data.suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")

    run = Run(suite_id=suite.id, models=data.models, status="pending")
    db.add(run)
    db.commit()
    db.refresh(run)

    # Run eval in background — API returns run ID immediately
    background_tasks.add_task(asyncio.run, execute_run(str(run.id), data.judge_model))

    return {"run_id": str(run.id), "status": "pending", "message": "Run started"}


@router.get("/")
def list_all_runs(db: Session = Depends(get_db)):
    runs = db.query(Run).order_by(Run.created_at.desc()).limit(50).all()
    result = []
    for r in runs:
        suite = db.query(TestSuite).filter(TestSuite.id == r.suite_id).first()
        result.append({
            "id": str(r.id),
            "suite_name": suite.name if suite else "Unknown Suite",
            "models": r.models,
            "status": r.status,
            "created_at": r.created_at,
            "completed_at": r.completed_at
        })
    return result


@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    results = db.query(Result).filter(Result.run_id == run_id).all()

    return {
        "id": str(run.id),
        "suite_id": str(run.suite_id),
        "models": run.models,
        "status": run.status,
        "created_at": run.created_at,
        "completed_at": run.completed_at,
        "results": [
            {
                "id": str(r.id),
                "test_case_id": str(r.test_case_id),
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
                "error": r.error
            }
            for r in results
        ]
    }


@router.get("/suite/{suite_id}")
def get_runs_for_suite(suite_id: str, db: Session = Depends(get_db)):
    """Get all runs for a suite — useful for tracking score history over time"""
    runs = db.query(Run).filter(Run.suite_id == suite_id).order_by(Run.created_at.desc()).all()
    return [
        {
            "id": str(r.id),
            "models": r.models,
            "status": r.status,
            "created_at": r.created_at,
            "result_count": len(r.results)
        }
        for r in runs
    ]
