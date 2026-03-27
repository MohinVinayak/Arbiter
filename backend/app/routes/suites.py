from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.test_suite import TestSuite, TestCase
from pydantic import BaseModel
from typing import Optional
import uuid

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
    test_cases: Optional[list[TestCaseCreate]] = []

# ── Routes ────────────────────────────────────────────────

@router.post("/")
def create_suite(data: SuiteCreate, db: Session = Depends(get_db)):
    suite = TestSuite(name=data.name, description=data.description)
    db.add(suite)
    db.flush()  # Get the ID before committing

    for tc in data.test_cases:
        test_case = TestCase(
            suite_id=suite.id,
            prompt_template=tc.prompt_template,
            input_variables=tc.input_variables,
            expected_output=tc.expected_output,
            checks=tc.checks
        )
        db.add(test_case)

    db.commit()
    db.refresh(suite)
    return {"id": str(suite.id), "name": suite.name, "message": "Suite created"}


@router.get("/")
def list_suites(db: Session = Depends(get_db)):
    suites = db.query(TestSuite).all()
    return [
        {
            "id": str(s.id),
            "name": s.name,
            "description": s.description,
            "test_case_count": len(s.test_cases),
            "created_at": s.created_at
        }
        for s in suites
    ]


@router.get("/{suite_id}")
def get_suite(suite_id: str, db: Session = Depends(get_db)):
    suite = db.query(TestSuite).filter(TestSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    return {
        "id": str(suite.id),
        "name": suite.name,
        "description": suite.description,
        "test_cases": [
            {
                "id": str(tc.id),
                "prompt_template": tc.prompt_template,
                "input_variables": tc.input_variables,
                "expected_output": tc.expected_output,
                "checks": tc.checks
            }
            for tc in suite.test_cases
        ]
    }


@router.delete("/{suite_id}")
def delete_suite(suite_id: str, db: Session = Depends(get_db)):
    suite = db.query(TestSuite).filter(TestSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    
    from app.models.run import Run, Result
    
    # 1. Find all runs for this suite and delete their results
    run_ids = db.query(Run.id).filter(Run.suite_id == suite_id).subquery()
    db.query(Result).filter(Result.run_id.in_(run_ids)).delete(synchronize_session=False)
    
    # 2. Delete all runs in this suite
    db.query(Run).filter(Run.suite_id == suite_id).delete(synchronize_session=False)
    
    # 3. Finally delete the suite (SQLAlchemy cascades to test_cases)
    db.delete(suite)
    db.commit()
    return {"message": "Suite deleted"}
