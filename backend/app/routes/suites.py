from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.test_suite import TestSuite, TestCase
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


# ── Pydantic Schemas ──────────────────────────────────────

class TestCaseCreate(BaseModel):
    prompt_template: str
    input_variables: Optional[dict] = None
    expected_output: Optional[str] = None
    checks: Optional[list] = None


class SuiteCreate(BaseModel):
    name: str
    description: Optional[str] = None
    test_cases: Optional[list[TestCaseCreate]] = []  # API clients
    cases: Optional[list[TestCaseCreate]] = []        # frontend alias


# ── Routes ────────────────────────────────────────────────

@router.post("")
@router.post("/")
def create_suite(data: SuiteCreate, db: Session = Depends(get_db)):
    suite = TestSuite(name=data.name, description=data.description)
    db.add(suite)
    db.flush()

    all_cases = data.test_cases or data.cases or []
    for tc in all_cases:
        if not tc.prompt_template.strip():
            continue
        db.add(TestCase(
            suite_id=suite.id,
            prompt_template=tc.prompt_template,
            input_variables=tc.input_variables,
            expected_output=tc.expected_output,
            checks=tc.checks,
        ))

    db.commit()
    db.refresh(suite)
    return _suite_detail(suite)


@router.get("")
@router.get("/")
def list_suites(db: Session = Depends(get_db)):
    suites = db.query(TestSuite).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "test_case_count": len(s.test_cases),
            "created_at": s.created_at,
        }
        for s in suites
    ]


@router.get("/{suite_id}")
def get_suite(suite_id: str, db: Session = Depends(get_db)):
    suite = _get_or_404(suite_id, db)
    return {
        "id": suite.id,
        "name": suite.name,
        "description": suite.description,
        "test_cases": [
            {
                "id": tc.id,
                "prompt_template": tc.prompt_template,
                "input_variables": tc.input_variables,
                "expected_output": tc.expected_output,
                "checks": tc.checks,
            }
            for tc in suite.test_cases
        ],
    }


@router.put("/{suite_id}")
def update_suite(suite_id: str, data: SuiteCreate, db: Session = Depends(get_db)):
    """Replace a suite's metadata and test cases atomically."""
    suite = _get_or_404(suite_id, db)

    suite.name = data.name
    suite.description = data.description

    # Replace all test cases
    db.query(TestCase).filter(TestCase.suite_id == suite_id).delete(
        synchronize_session=False
    )

    all_cases = data.test_cases or data.cases or []
    for tc in all_cases:
        if not tc.prompt_template.strip():
            continue
        db.add(TestCase(
            suite_id=suite.id,
            prompt_template=tc.prompt_template,
            input_variables=tc.input_variables,
            expected_output=tc.expected_output,
            checks=tc.checks,
        ))

    db.commit()
    db.refresh(suite)
    return _suite_detail(suite)


@router.delete("/{suite_id}")
def delete_suite(suite_id: str, db: Session = Depends(get_db)):
    suite = _get_or_404(suite_id, db)

    from app.models.run import Run, Result

    # Delete results → runs → test_cases → suite (respecting FK constraints)
    run_ids = [r.id for r in db.query(Run.id).filter(Run.suite_id == suite_id).all()]
    if run_ids:
        db.query(Result).filter(Result.run_id.in_(run_ids)).delete(
            synchronize_session=False
        )
    db.query(Run).filter(Run.suite_id == suite_id).delete(synchronize_session=False)
    db.delete(suite)
    db.commit()
    return {"message": "Suite deleted"}


# ── Helpers ───────────────────────────────────────────────

def _get_or_404(suite_id: str, db: Session) -> TestSuite:
    suite = db.query(TestSuite).filter(TestSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    return suite


def _suite_detail(suite: TestSuite) -> dict:
    return {
        "id": suite.id,
        "name": suite.name,
        "description": suite.description,
        "test_case_count": len(suite.test_cases),
        "cases": [
            {
                "id": tc.id,
                "prompt_template": tc.prompt_template,
                "expected_output": tc.expected_output,
            }
            for tc in suite.test_cases
        ],
    }
