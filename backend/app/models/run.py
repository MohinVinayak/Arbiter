import uuid
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON, Float, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Run(Base):
    """Execution of a test suite against target models."""
    __tablename__ = "runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, index=True, nullable=True)
    suite_id = Column(String, ForeignKey("test_suites.id"), nullable=False)
    models = Column(JSON, nullable=False)
    status = Column(String, default="pending")  # pending | running | completed | failed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    suite = relationship("TestSuite", back_populates="runs")
    results = relationship("Result", back_populates="run", cascade="all, delete")


class Result(Base):
    """Inference output and evaluation scores for one test case and model."""
    __tablename__ = "results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String, ForeignKey("runs.id"), nullable=False, index=True)
    test_case_id = Column(String, ForeignKey("test_cases.id"), nullable=False, index=True)

    model = Column(String, nullable=False)
    output = Column(Text, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    tokens_used = Column(Integer, nullable=True)
    cost_usd = Column(Float, nullable=True)

    deterministic_score = Column(Float, nullable=True)
    judge_score = Column(Float, nullable=True)
    overall_score = Column(Float, nullable=True)

    check_details = Column(JSON, nullable=True)
    judge_reasoning = Column(Text, nullable=True)
    error = Column(Text, nullable=True)

    run = relationship("Run", back_populates="results")
