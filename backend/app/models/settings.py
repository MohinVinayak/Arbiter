from sqlalchemy import Column, String, DateTime, inspect
from sqlalchemy.sql import func
from app.database import Base
import uuid


class AppSettings(Base):
    __tablename__ = "app_settings"

    # Plain String PK works on both SQLite and PostgreSQL
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    gemini_api_key = Column(String, nullable=True)
    openai_api_key = Column(String, nullable=True)
    anthropic_api_key = Column(String, nullable=True)
    openrouter_api_key = Column(String, nullable=True)
    groq_api_key = Column(String, nullable=True)
    github_token = Column(String, nullable=True)
    deepseek_api_key = Column(String, nullable=True)
    mistral_api_key = Column(String, nullable=True)

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
