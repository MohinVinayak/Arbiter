from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base
import uuid

class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    gemini_api_key = Column(String, nullable=True)
    openai_api_key = Column(String, nullable=True)
    anthropic_api_key = Column(String, nullable=True)
    openrouter_api_key = Column(String, nullable=True)
    groq_api_key = Column(String, nullable=True)
    github_token = Column(String, nullable=True)
    
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
