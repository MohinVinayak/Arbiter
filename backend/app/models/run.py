from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON, Float, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid

class Run(Base):
    """A single execution of a test suite against one or more models"""
    __tablename__ = "runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("test_suites.id"), nullable=False)
    models = Column(JSON, nullable=False)      # e.g. ["gemini", "gpt-4"]
    status = Column(String, default="pending") # pending | running | completed | failed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    suite = relationship("TestSuite", back_populates="runs")
    results = relationship("Result", back_populates="run", cascade="all, delete")


class Result(Base):
    """Output + scores for one test case × one model"""
    __tablename__ = "results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False)
    test_case_id = Column(UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False)

    model = Column(String, nullable=False)           # e.g. "gemini-pro"
    output = Column(Text, nullable=True)             # Raw LLM response
    latency_ms = Column(Integer, nullable=True)      # How long it took
    tokens_used = Column(Integer, nullable=True)     # Token count
    cost_usd = Column(Float, nullable=True)          # Estimated cost

    # Scores
    deterministic_score = Column(Float, nullable=True)  # Rule-based checks (0-1)
    semantic_score = Column(Float, nullable=True)        # Embedding similarity (0-1)
    judge_score = Column(Float, nullable=True)           # LLM-as-judge (0-1)
    overall_score = Column(Float, nullable=True)         # Weighted average

    check_details = Column(JSON, nullable=True)  # Per-check pass/fail breakdown
    judge_reasoning = Column(Text, nullable=True) # Why the judge gave this score
    error = Column(Text, nullable=True)           # If the LLM call failed

    run = relationship("Run", back_populates="results")
