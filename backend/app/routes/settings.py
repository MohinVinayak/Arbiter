from fastapi import APIRouter
from app.utils.keys import get_env_key_status

router = APIRouter()


@router.get("/")
def get_settings():
    """
    Returns which providers have a server-side API key configured (True/False).
    User keys are stored client-side only and are never sent to this endpoint.
    """
    return {"server_keys": get_env_key_status()}
