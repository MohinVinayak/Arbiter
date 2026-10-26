import asyncio
import logging
import time

from google import genai
from openai import AsyncOpenAI

logger = logging.getLogger("uvicorn.error")

_client_cache: dict[tuple, dict] = {}
LLM_TIMEOUT = 30  # seconds


def _make_clients(resolved: dict) -> dict:
    """Create or retrieve cached API clients for Google, Groq, and OpenAI."""
    cache_key = tuple(sorted(resolved.items()))
    if cache_key in _client_cache:
        return _client_cache[cache_key]

    if len(_client_cache) >= 50:
        _client_cache.pop(next(iter(_client_cache)), None)

    def _oa(key, base_url):
        return AsyncOpenAI(api_key=key, base_url=base_url) if key else None

    clients = {
        "google": genai.Client(api_key=resolved["gemini_api_key"]) if resolved.get("gemini_api_key") else None,
        "groq":   _oa(resolved.get("groq_api_key"), "https://api.groq.com/openai/v1"),
        "openai": _oa(resolved.get("openai_api_key"), "https://api.openai.com/v1"),
    }
    _client_cache[cache_key] = clients
    return clients


async def run_llm(model: str, prompt: str, resolved: dict = None) -> dict:
    """Run a single LLM inference call with provider routing and timeout protection."""
    resolved = resolved or {}
    clients = _make_clients(resolved)
    start = time.time()

    provider, has_sep, model_name = model.partition("/")
    if not has_sep:
        provider, model_name = "google", provider

    client = clients.get(provider)
    if not client:
        return _error(f"{provider.capitalize()} key not configured", start)

    try:
        if provider == "google":
            coro = _run_gemini(client, model_name, prompt, start)
        else:
            coro = _run_oa(client, model_name, prompt, start)

        return await asyncio.wait_for(coro, timeout=LLM_TIMEOUT)
    except asyncio.TimeoutError:
        logger.error(f"Timeout: {model} exceeded {LLM_TIMEOUT}s")
        return _error(f"Timeout: model did not respond within {LLM_TIMEOUT}s", start)
    except Exception as e:
        logger.error(f"LLM failure [{model}]: {e}")
        return _error(str(e), start)


async def run_parallel(model_list: list, prompt: str, resolved: dict = None) -> dict:
    """Execute LLM inference concurrently across models."""
    tasks = [run_llm(m, prompt, resolved) for m in model_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(model_list, results))


async def _run_gemini(client, model_name: str, prompt: str, start: float):
    response = await asyncio.to_thread(client.models.generate_content, model=model_name, contents=prompt)
    latency = int((time.time() - start) * 1000)
    tokens = response.usage_metadata.total_token_count if hasattr(response, "usage_metadata") and response.usage_metadata else None
    return {"output": response.text, "latency_ms": latency, "tokens_used": tokens, "cost_usd": _cost(model_name, tokens), "error": None}


async def _run_oa(client, model_name: str, prompt: str, start: float):
    response = await client.chat.completions.create(model=model_name, messages=[{"role": "user", "content": prompt}])
    latency = int((time.time() - start) * 1000)
    tokens = response.usage.total_tokens if response.usage else None
    return {"output": response.choices[0].message.content, "latency_ms": latency, "tokens_used": tokens, "cost_usd": _cost(model_name, tokens), "error": None}


def _cost(model: str, tokens: int | None) -> float:
    if not tokens:
        return 0.0
    # Blended commercial rates ($/1k tokens) for accurateish estimations
    rates = {
        "gpt-4o": 0.005,
        "gpt-4o-mini": 0.0003,
        "gemini-2.0-flash": 0.00015,
        "gemini-1.5-flash": 0.00015,
        "gemini-1.5-pro": 0.0025,
        "llama-3.3-70b-versatile": 0.0007,
        "llama-3.1-8b-instant": 0.00007,
        "deepseek-r1-distill-llama-70b": 0.0007,
    }
    rate = rates.get(model)
    return round((tokens / 1000) * rate, 6) if rate else 0.0


def _error(msg: str, start: float) -> dict:
    return {"output": None, "latency_ms": int((time.time() - start) * 1000), "tokens_used": None, "cost_usd": None, "error": msg}
