import os
from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Canonical model catalogue
# Maps provider prefix → (settings_attr, [model_ids])
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
    "openai":    ("openai_api_key",     ["openai/gpt-4o", "openai/gpt-4o-mini", "openai/o1-mini", "openai/o3-mini"]),
    "openrouter":("openrouter_api_key", []),   # populated via CUSTOM_MODELS
    "deepseek":  ("deepseek_api_key",   ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"]),
    "mistral":   ("mistral_api_key",    ["mistral/mistral-large-latest", "mistral/mistral-small-latest"]),
}

# Env-var name for each key attribute
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

# HTTP header name → key attribute  (sent by the frontend per-request)
_HEADER_TO_ATTR = {
    "x-gemini-key":     "gemini_api_key",
    "x-groq-key":       "groq_api_key",
    "x-openai-key":     "openai_api_key",
    "x-anthropic-key":  "anthropic_api_key",
    "x-openrouter-key": "openrouter_api_key",
    "x-github-token":   "github_token",
    "x-deepseek-key":   "deepseek_api_key",
    "x-mistral-key":    "mistral_api_key",
}


def get_resolved_keys(request=None, db: Session = None) -> dict[str, str]:
    """
    Return {attr: key_value} for every provider, in priority order:

      1. Request headers (user's own key, sent from localStorage)   ← highest
      2. Server .env vars (admin/demo fallback)                     ← lowest

    Keys are NEVER stored in the database — this is intentional.
    The DB parameter is kept for signature compatibility but unused.
    """
    # Start from server env vars
    resolved = {
        attr: os.getenv(env_var, "").strip()
        for attr, env_var in _ATTR_TO_ENV.items()
    }

    # Override with any per-request headers the user supplied
    if request is not None:
        for header, attr in _HEADER_TO_ATTR.items():
            val = request.headers.get(header, "").strip()
            if val:
                resolved[attr] = val

    return resolved


def get_available_models(resolved: dict[str, str]) -> list[str]:
    """Return models whose provider key is present in `resolved`."""
    models: list[str] = []

    for _prefix, (attr, model_list) in MODEL_CATALOGUE.items():
        if resolved.get(attr):
            models.extend(model_list)

    # Extra models injected via CUSTOM_MODELS env var
    for m in os.getenv("CUSTOM_MODELS", "").split(","):
        m = m.strip()
        if m and m not in models:
            models.append(m)

    if not models:
        models = ["mock/alpha-test", "mock/beta-test"]

    return models


def get_env_key_status() -> dict[str, bool]:
    """
    Returns which providers have a server-side env var key configured.
    Sent to the frontend so users know which providers work without their own key.
    """
    return {
        attr: bool(os.getenv(env_var, "").strip())
        for attr, env_var in _ATTR_TO_ENV.items()
    }
