import os
from app.models.settings import AppSettings
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# The canonical model catalogue.
# Maps provider prefix → list of (model_id, required_key_attr_on_AppSettings)
# Add new providers/models here only — nothing else needs to change.
# ---------------------------------------------------------------------------
MODEL_CATALOGUE = {
    "google":    ("gemini_api_key",     [
                     "google/gemini-2.5-flash",
                     "google/gemini-2.5-flash-lite",
                     "google/gemini-2.0-flash",
                 ]),
    "groq":      ("groq_api_key",       ["groq/llama-3.3-70b-versatile", "groq/llama-3.1-8b-instant"]),
    "anthropic": ("anthropic_api_key",  ["anthropic/claude-3-haiku-20240307"]),
    "github":    ("github_token",       ["github/gpt-4o-mini"]),
    "openrouter":("openrouter_api_key", []),   # populated via CUSTOM_MODELS
    "deepseek":  ("deepseek_api_key",   ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"]),
    "mistral":   ("mistral_api_key",    ["mistral/mistral-large-latest", "mistral/mistral-small-latest"]),
}

# Env-var name for each settings attr (used as fallback)
_ATTR_TO_ENV = {
    "gemini_api_key":     "GEMINI_API_KEY",
    "openai_api_key":     "OPENAI_API_KEY",
    "anthropic_api_key":  "ANTHROPIC_API_KEY",
    "openrouter_api_key": "OPENROUTER_API_KEY",
    "groq_api_key":       "GROQ_API_KEY",
    "github_token":       "GITHUB_TOKEN",
    "deepseek_api_key":   "DEEPSEEK_API_KEY",
    "mistral_api_key":    "MISTRAL_API_KEY",
}


def resolve_key(db_value: str | None, env_var: str) -> str:
    """
    DB wins if non-empty, otherwise fall back to the matching .env value.
    This is the single place where priority is defined.
    """
    if db_value and db_value.strip():
        return db_value.strip()
    return os.getenv(env_var, "")


def get_resolved_keys(db: Session) -> dict[str, str]:
    """
    Return a dict of {attr_name: resolved_key} for every provider attr.
    Reads the single app_settings row (auto-creates if missing).
    """
    row = db.query(AppSettings).first()
    if not row:
        row = AppSettings()
        db.add(row)
        db.commit()
        db.refresh(row)

    return {
        attr: resolve_key(getattr(row, attr, None), env_var)
        for attr, env_var in _ATTR_TO_ENV.items()
    }


def get_available_models(resolved: dict[str, str]) -> list[str]:
    """
    Given a resolved-keys dict, return only the models whose provider key
    is non-empty.  Also appends CUSTOM_MODELS from the environment.
    """
    models: list[str] = []

    for _prefix, (attr, model_list) in MODEL_CATALOGUE.items():
        if resolved.get(attr):
            models.extend(model_list)

    # Custom models injected via env (e.g. openrouter extras)
    custom = os.getenv("CUSTOM_MODELS", "")
    for m in custom.split(","):
        m = m.strip()
        if m and m not in models:
            models.append(m)

    if not models:
        models = ["mock/alpha-test", "mock/beta-test"]

    return models
