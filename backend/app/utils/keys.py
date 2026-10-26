import os

# Verified active models available on free or low-cost tiers
MODEL_CATALOGUE = {
    "google": ("gemini_api_key", [
        "google/gemini-2.0-flash",
        "google/gemini-1.5-flash",
        "google/gemini-1.5-pro",
    ]),
    "groq": ("groq_api_key", [
        "groq/llama-3.3-70b-versatile",
        "groq/llama-3.1-8b-instant",
        "groq/deepseek-r1-distill-llama-70b",
    ]),
    "openai": ("openai_api_key", [
        "openai/gpt-4o-mini",
        "openai/gpt-4o",
    ]),
}

_ATTR_TO_ENV = {
    "gemini_api_key": "GEMINI_API_KEY",
    "groq_api_key":   "GROQ_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
}

_HEADER_TO_ATTR = {
    "x-gemini-key": "gemini_api_key",
    "x-groq-key":   "groq_api_key",
    "x-openai-key": "openai_api_key",
}


def get_resolved_keys(request=None) -> dict[str, str]:
    """
    Resolve API keys in priority order:
      1. Request headers (client BYOK keys from localStorage)
      2. Server .env environment variables (fallback)
    """
    resolved = {attr: os.getenv(env_var, "").strip() for attr, env_var in _ATTR_TO_ENV.items()}
    if request is not None:
        for header, attr in _HEADER_TO_ATTR.items():
            val = request.headers.get(header, "").strip()
            if val:
                resolved[attr] = val
    return resolved


def get_available_models(resolved: dict[str, str]) -> list[str]:
    """Return model IDs whose provider API key is present."""
    models: list[str] = []
    for _prefix, (attr, model_list) in MODEL_CATALOGUE.items():
        if resolved.get(attr):
            models.extend(model_list)

    for m in os.getenv("CUSTOM_MODELS", "").split(","):
        m = m.strip()
        if m and m not in models:
            models.append(m)

    if not models:
        models = ["mock/alpha-test", "mock/beta-test"]

    return models


def get_env_key_status() -> dict[str, bool]:
    """Return configured server-side keys for settings display."""
    return {attr: bool(os.getenv(env_var, "").strip()) for attr, env_var in _ATTR_TO_ENV.items()}
