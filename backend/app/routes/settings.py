from fastapi import APIRouter
from app.utils.keys import get_env_key_status

router = APIRouter()


@router.get("")
@router.get("/")
def get_settings():
    """Return available server-side API key status."""
    return {"server_keys": get_env_key_status()}
