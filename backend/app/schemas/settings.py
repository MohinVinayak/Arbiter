from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SettingsBase(BaseModel):
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    github_token: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    mistral_api_key: Optional[str] = None


class SettingsUpdate(SettingsBase):
    pass


class SettingsResponse(SettingsBase):
    id: str   # String (not UUID) so it works with both SQLite and Postgres
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
