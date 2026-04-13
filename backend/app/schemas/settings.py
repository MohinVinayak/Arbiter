from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

class SettingsBase(BaseModel):
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    github_token: Optional[str] = None

class SettingsUpdate(SettingsBase):
    pass

class SettingsResponse(SettingsBase):
    id: UUID
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
