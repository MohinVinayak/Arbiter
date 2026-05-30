import asyncio
import logging
import time

import anthropic
from google import genai
from openai import AsyncOpenAI
from sqlalchemy.orm import Session

from app.utils.keys import get_resolved_keys

logger = logging.getLogger("uvicorn.error")


# ---------------------------------------------------------------------------
# Client factory — called per-request so DB-overridden keys are always fresh
# ---------------------------------------------------------------------------

def _make_clients(resolved: dict) -> dict:
    """Build provider clients from a resolved-keys dict."""

    def _openai_compat(key, base_url):
        return AsyncOpenAI(api_key=key, base_url=base_url) if key else None

    return {
        "gemini": (
            genai.Client(api_key=resolved["gemini_api_key"])
            if resolved.get("gemini_api_key")
            else None
        ),
        "groq": _openai_compat(resolved.get("groq_api_key"), "https://api.groq.com/openai/v1"),
        "github": _openai_compat(resolved.get("github_token"), "https://models.inference.ai.azure.com"),
        "anthropic": (
            anthropic.AsyncAnthropic(api_key=resolved["anthropic_api_key"])
            if resolved.get("anthropic_api_key")
            else None
        ),
        # DeepSeek exposes an OpenAI-compatible endpoint
        "deepseek": _openai_compat(resolved.get("deepseek_api_key"), "https://api.deepseek.com/v1"),
        # Mistral also exposes an OpenAI-compatible endpoint
        "mistral": _openai_compat(resolved.get("mistral_api_key"), "https://api.mistral.ai/v1"),
        "openrouter": _openai_compat(resolved.get("openrouter_api_key"), "https://openrouter.ai/api/v1"),
    }


# ---------------------------------------------------------------------------
# Public entry-points
# ---------------------------------------------------------------------------

async def run_llm(model: str, prompt: str, db: Session = None) -> dict:
    """
    Run a single LLM call.
    Pass db so DB-overridden keys are always used at request time.
    Falls back to .env if db is None.
    """
    resolved = get_resolved_keys(db) if db else {}
    clients = _make_clients(resolved)
    start = time.time()

    try:
        logger.info(f"   -> Calling LLM API: {model}")

        if model.startswith("google/"):
            return await _run_gemini(
                clients["gemini"], model.replace("google/", ""), prompt, start
            )
        elif model.startswith("groq/"):
            if not clients["groq"]:
                return _error_result("Groq API key not configured", start)
            return await _run_openai_compat(
                clients["groq"], model.replace("groq/", ""), prompt, start
            )
        elif model.startswith("github/"):
            if not clients["github"]:
                return _error_result("GitHub token not configured", start)
            return await _run_openai_compat(
                clients["github"], model.replace("github/", ""), prompt, start
            )
        elif model.startswith("anthropic/"):
            if not clients["anthropic"]:
                return _error_result("Anthropic API key not configured", start)
            return await _run_anthropic(
                clients["anthropic"], model.replace("anthropic/", ""), prompt, start
            )
        elif model.startswith("deepseek/"):
            if not clients["deepseek"]:
                return _error_result("DeepSeek API key not configured", start)
            return await _run_openai_compat(
                clients["deepseek"], model.replace("deepseek/", ""), prompt, start
            )
        elif model.startswith("mistral/"):
            if not clients["mistral"]:
                return _error_result("Mistral API key not configured", start)
            return await _run_openai_compat(
                clients["mistral"], model.replace("mistral/", ""), prompt, start
            )
        else:
            # Default: treat as OpenRouter model ID (e.g. "meta-llama/llama-3-8b")
            if not clients["openrouter"]:
                return _error_result("OpenRouter API key not configured", start)
            return await _run_openai_compat(
                clients["openrouter"], model, prompt, start
            )

    except Exception as exc:
        logger.error(f"   [FAIL] LLM API: {model} — {exc}")
        return _error_result(str(exc), start)


async def run_parallel(model_list: list, prompt: str, db: Session = None) -> dict:
    """Run the same prompt across all models concurrently."""
    tasks = [run_llm(m, prompt, db) for m in model_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(model_list, results))


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

async def _run_gemini(client, model_name: str, prompt: str, start: float) -> dict:
    if not client:
        return _error_result("Gemini API key not configured", start)
    response = await asyncio.to_thread(
        client.models.generate_content, model=model_name, contents=prompt
    )
    latency = int((time.time() - start) * 1000)
    tokens = (
        response.usage_metadata.total_token_count
        if hasattr(response, "usage_metadata") and response.usage_metadata
        else None
    )
    return {
        "output": response.text,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": _estimate_cost(model_name, tokens),
        "error": None,
    }


async def _run_openai_compat(client: AsyncOpenAI, model: str, prompt: str, start: float) -> dict:
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    latency = int((time.time() - start) * 1000)
    tokens = response.usage.total_tokens if response.usage else None
    return {
        "output": response.choices[0].message.content,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": 0.0,
        "error": None,
    }


async def _run_anthropic(client, model_name: str, prompt: str, start: float) -> dict:
    response = await client.messages.create(
        model=model_name,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    latency = int((time.time() - start) * 1000)
    tokens = (
        response.usage.input_tokens + response.usage.output_tokens
        if response.usage
        else None
    )
    return {
        "output": response.content[0].text if response.content else None,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": 0.0,
        "error": None,
    }


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _estimate_cost(model: str, tokens: int | None) -> float:
    if not tokens:
        return 0.0
    rates = {
        "gemini-2.5-flash": 0.000015,
        "gemini-2.0-flash": 0.00001875,
        "gemini-1.5-flash": 0.000007,
    }
    return round((tokens / 1000) * rates.get(model, 0.0), 6)


def _error_result(error: str, start: float) -> dict:
    return {
        "output": None,
        "latency_ms": int((time.time() - start) * 1000),
        "tokens_used": None,
        "cost_usd": None,
        "error": error,
    }