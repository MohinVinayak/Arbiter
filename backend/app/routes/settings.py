from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Any
from app.database import get_db
from app.models.settings import AppSettings
from app.schemas.settings import SettingsResponse, SettingsUpdate

router = APIRouter()

@router.get("/", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db)) -> Any:
    settings = db.query(AppSettings).first()
    if not settings:
        settings = AppSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@router.post("/", response_model=SettingsResponse)
def update_settings(settings_in: SettingsUpdate, db: Session = Depends(get_db)) -> Any:
    settings = db.query(AppSettings).first()
    if not settings:
        settings = AppSettings()
        db.add(settings)
    
    update_data = settings_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(settings, field, value)
    
    db.commit()
    db.refresh(settings)
    return settings
