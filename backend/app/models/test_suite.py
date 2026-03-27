from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid

class TestSuite(Base):
    __tablename__ = "test_suites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # One suite has many test cases
    test_cases = relationship("TestCase", back_populates="suite", cascade="all, delete")
    runs = relationship("Run", back_populates="suite", cascade="all, delete")


class TestCase(Base):
    __tablename__ = "test_cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("test_suites.id"), nullable=False)

    prompt_template = Column(Text, nullable=False)   # e.g. "Summarize this: {input}"
    input_variables = Column(JSON, nullable=True)    # e.g. {"input": "some long text..."}
    expected_output = Column(Text, nullable=True)    # Optional reference answer

    # Checks to run on output
    checks = Column(JSON, nullable=True)
    # e.g. [
    #   {"type": "max_length", "value": 100},
    #   {"type": "must_contain", "value": "keyword"},
    #   {"type": "tone", "value": "neutral"}
    # ]

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    suite = relationship("TestSuite", back_populates="test_cases")
