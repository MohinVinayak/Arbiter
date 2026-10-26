import json
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.run import Result, Run
from app.models.test_suite import TestSuite
from app.services.evaluator import compute_overall_score, run_deterministic_checks, run_llm_judge
from app.services.llm_runner import run_parallel
from app.utils.keys import get_resolved_keys, get_available_models

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


class EvalRequest(BaseModel):
    """Request schema supporting camelCase and snake_case keys."""
    suiteId: Optional[str] = None
    suite_id: Optional[str] = None
    models: list[str]
    judgeId: Optional[str] = None
    judge_model: Optional[str] = "google/gemini-2.0-flash"

    @property
    def target_suite_id(self) -> str:
        return self.suiteId or self.suite_id or ""

    @property
    def target_judge_model(self) -> str:
        return self.judgeId or self.judge_model or "google/gemini-2.0-flash"


def _validate_run_request(body: EvalRequest, request: Request, db: Session) -> tuple[TestSuite, dict]:
    """Validate suite existence, test cases, and model availability."""
    suite_id = body.target_suite_id
    if not suite_id:
        raise HTTPException(400, "Missing suite_id parameter.")

    suite = db.query(TestSuite).filter(TestSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(404, f"Suite '{suite_id}' not found.")
    if not suite.test_cases:
        raise HTTPException(400, "Suite has no test cases.")

    resolved = get_resolved_keys(request=request)
    available = get_available_models(resolved)
    bad = [m for m in body.models if m not in available and not m.startswith("mock/")]
    if bad:
        raise HTTPException(400, f"Models not available (key missing?): {bad}")

    return suite, resolved


async def _stream_eval_generator(suite: TestSuite, models: list[str], judge_model: str,
                                 db: Session, resolved: dict, workspace_id: str = None):
    """Core evaluation engine that yields real-time SSE progress events."""
    run = Run(suite_id=suite.id, models=models, status="running", workspace_id=workspace_id)
    db.add(run)
    db.commit()
    db.refresh(run)

    total_cases = len(suite.test_cases)
    yield f"data: {json.dumps({'event': 'start', 'run_id': run.id, 'total_cases': total_cases, 'models': models})}\n\n"

    accum = {m: {"scores": [], "latencies": [], "reasonings": [], "tokens": 0, "cost": 0.0, "outputs": []} for m in models}

    try:
        for idx, tc in enumerate(suite.test_cases):
            prompt = tc.prompt_template
            if tc.input_variables:
                for k, v in tc.input_variables.items():
                    prompt = prompt.replace(f"{{{k}}}", str(v))

            # Candidate model inference in parallel
            llm_outputs = await run_parallel(models, prompt, resolved)

            model_results = {}
            for model in models:
                res = llm_outputs.get(model)
                if isinstance(res, Exception):
                    res = {"output": None, "latency_ms": 0, "tokens_used": 0, "cost_usd": 0.0, "error": str(res)}
                model_results[model] = res or {}

            # Concurrent LLM judge evaluation
            judge_tasks = [
                run_llm_judge(
                    prompt=prompt,
                    output=model_results[m].get("output"),
                    expected=tc.expected_output,
                    judge_model=judge_model,
                    resolved=resolved
                )
                for m in models
            ]
            judge_outputs = await asyncio.gather(*judge_tasks, return_exceptions=True)

            # Score computation and persistence
            case_scores = {}
            for model, judge_res in zip(models, judge_outputs):
                if isinstance(judge_res, Exception):
                    judge_res = {"score": None, "reasoning": f"Judge error: {judge_res}"}

                res = model_results[model]
                output = res.get("output")
                det = run_deterministic_checks(output, tc.checks or [])
                overall = compute_overall_score(det["score"], judge_res.get("score"))

                db.add(Result(
                    run_id=run.id, test_case_id=tc.id, model=model,
                    output=output, latency_ms=res.get("latency_ms"),
                    tokens_used=res.get("tokens_used"), cost_usd=res.get("cost_usd"),
                    deterministic_score=det["score"],
                    judge_score=judge_res.get("score"), overall_score=overall,
                    check_details=det["details"], judge_reasoning=judge_res.get("reasoning"),
                    error=res.get("error"),
                ))

                if overall is not None: accum[model]["scores"].append(overall)
                if res.get("latency_ms"): accum[model]["latencies"].append(res["latency_ms"])
                if judge_res.get("reasoning"): accum[model]["reasonings"].append(judge_res["reasoning"])
                accum[model]["tokens"] += res.get("tokens_used") or 0
                accum[model]["cost"] += res.get("cost_usd") or 0.0
                accum[model]["outputs"].append(output)

                case_scores[model] = {
                    "score": round(overall * 100) if overall is not None else 0,
                    "latency": res.get("latency_ms") or 0,
                }

            db.commit()
            yield f"data: {json.dumps({'event': 'case_completed', 'case_index': idx + 1, 'total_cases': total_cases, 'case_id': tc.id, 'case_scores': case_scores})}\n\n"

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        run.status = "failed"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
        return
    finally:
        db.commit()

    metrics = []
    for model in models:
        a = accum[model]
        avg = round((sum(a["scores"]) / len(a["scores"])) * 100) if a["scores"] else 0
        lat = round(sum(a["latencies"]) / len(a["latencies"])) if a["latencies"] else 0
        reasoning = "; ".join(a["reasonings"]) if a["reasonings"] else "No judge output."
        metrics.append({
            "id": model, "score": avg, "latency": lat,
            "status": "Passed" if avg >= 80 else "Review" if avg >= 70 else "Failed",
            "reasoning": reasoning,
            "outputs": a["outputs"], "tokens": a["tokens"], "cost": round(a["cost"], 6),
        })

    yield f"data: {json.dumps({'event': 'complete', 'run_id': run.id, 'status': run.status, 'metrics': metrics})}\n\n"


async def _run_eval(suite: TestSuite, models: list[str], judge_model: str,
                    db: Session, resolved: dict, workspace_id: str = None):
    """Execute evaluation and return final run record and metrics."""
    run_id = None
    metrics = []
    async for chunk in _stream_eval_generator(suite, models, judge_model, db, resolved, workspace_id):
        if chunk.startswith("data: "):
            payload = json.loads(chunk[6:].strip())
            if payload.get("event") == "complete":
                run_id = payload.get("run_id")
                metrics = payload.get("metrics")
    run = db.query(Run).filter(Run.id == run_id).first()
    return run, metrics


@router.post("/evaluate/stream")
async def run_evaluate_stream(request: Request, body: EvalRequest, db: Session = Depends(get_db)):
    """Stream real-time evaluation events via Server-Sent Events (SSE)."""
    suite, resolved = _validate_run_request(body, request, db)
    return StreamingResponse(
        _stream_eval_generator(suite, body.models, body.target_judge_model, db, resolved, request.headers.get("X-Workspace-ID")),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/evaluate")
@router.post("/")
async def run_evaluate(request: Request, body: EvalRequest, db: Session = Depends(get_db)):
    """Run evaluation and return complete aggregated results."""
    suite, resolved = _validate_run_request(body, request, db)
    run, metrics = await _run_eval(suite, body.models, body.target_judge_model, db, resolved, request.headers.get("X-Workspace-ID"))
    return {"run_id": run.id, "status": run.status, "metrics": metrics}


@router.get("/")
def list_all_runs(request: Request, db: Session = Depends(get_db)):
    """List recent evaluation runs."""
    workspace_id = request.headers.get("X-Workspace-ID")
    query = db.query(Run).options(joinedload(Run.suite))
    if workspace_id:
        query = query.filter(Run.workspace_id == workspace_id)

    runs = query.order_by(Run.created_at.desc()).limit(50).all()
    return [
        {
            "id": r.id,
            "suite_name": r.suite.name if r.suite else "Unknown",
            "models": r.models,
            "status": r.status,
            "created_at": r.created_at,
            "completed_at": r.completed_at,
        }
        for r in runs
    ]


@router.get("/suite/{suite_id}")
def get_runs_for_suite(suite_id: str, request: Request, db: Session = Depends(get_db)):
    """List runs for a specific suite."""
    workspace_id = request.headers.get("X-Workspace-ID")
    query = db.query(Run).options(joinedload(Run.results)).filter(Run.suite_id == suite_id)
    if workspace_id:
        query = query.filter(Run.workspace_id == workspace_id)
    runs = query.order_by(Run.created_at.desc()).all()
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
    """Get full details of a specific evaluation run."""
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
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
