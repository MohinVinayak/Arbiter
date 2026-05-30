import asyncio
import logging
import time

import anthropic
from google import genai
from openai import AsyncOpenAI
from app.utils.keys import get_resolved_keys

logger = logging.getLogger("uvicorn.error")


def _make_clients(resolved: dict) -> dict:
    def _oa(key, base_url):
        return AsyncOpenAI(api_key=key, base_url=base_url) if key else None

    return {
        "gemini":    genai.Client(api_key=resolved["gemini_api_key"]) if resolved.get("gemini_api_key") else None,
        "groq":      _oa(resolved.get("groq_api_key"),      "https://api.groq.com/openai/v1"),
        "github":    _oa(resolved.get("github_token"),       "https://models.inference.ai.azure.com"),
        "openai":    _oa(resolved.get("openai_api_key"),     "https://api.openai.com/v1"),
        "anthropic": anthropic.AsyncAnthropic(api_key=resolved["anthropic_api_key"]) if resolved.get("anthropic_api_key") else None,
        "deepseek":  _oa(resolved.get("deepseek_api_key"),   "https://api.deepseek.com/v1"),
        "mistral":   _oa(resolved.get("mistral_api_key"),    "https://api.mistral.ai/v1"),
        "openrouter":_oa(resolved.get("openrouter_api_key"), "https://openrouter.ai/api/v1"),
    }


async def run_llm(model: str, prompt: str, resolved: dict = None) -> dict:
    """Run a single LLM call using pre-resolved API keys."""
    resolved = resolved or {}
    clients = _make_clients(resolved)
    start = time.time()
    try:
        logger.info(f"   -> Calling: {model}")
        if model.startswith("google/"):
            return await _run_gemini(clients["gemini"], model.replace("google/", ""), prompt, start)
        elif model.startswith("groq/"):
            if not clients["groq"]: return _error("Groq key not configured", start)
            return await _run_oa(clients["groq"], model.replace("groq/", ""), prompt, start)
        elif model.startswith("github/"):
            if not clients["github"]: return _error("GitHub token not configured", start)
            return await _run_oa(clients["github"], model.replace("github/", ""), prompt, start)
        elif model.startswith("anthropic/"):
            if not clients["anthropic"]: return _error("Anthropic key not configured", start)
            return await _run_anthropic(clients["anthropic"], model.replace("anthropic/", ""), prompt, start)
        elif model.startswith("deepseek/"):
            if not clients["deepseek"]: return _error("DeepSeek key not configured", start)
            return await _run_oa(clients["deepseek"], model.replace("deepseek/", ""), prompt, start)
        elif model.startswith("mistral/"):
            if not clients["mistral"]: return _error("Mistral key not configured", start)
            return await _run_oa(clients["mistral"], model.replace("mistral/", ""), prompt, start)
        elif model.startswith("openai/"):
            if not clients["openai"]: return _error("OpenAI key not configured", start)
            return await _run_oa(clients["openai"], model.replace("openai/", ""), prompt, start)
        else:
            if not clients["openrouter"]: return _error("OpenRouter key not configured", start)
            return await _run_oa(clients["openrouter"], model, prompt, start)
    except Exception as e:
        logger.error(f"   [FAIL] {model}: {e}")
        return _error(str(e), start)


async def run_parallel(model_list: list, prompt: str, resolved: dict = None) -> dict:
    tasks = [run_llm(m, prompt, resolved) for m in model_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(model_list, results))


async def _run_gemini(client, model_name, prompt, start):
    if not client: return _error("Gemini key not configured", start)
    response = await asyncio.to_thread(client.models.generate_content, model=model_name, contents=prompt)
    latency = int((time.time() - start) * 1000)
    tokens = response.usage_metadata.total_token_count if hasattr(response, "usage_metadata") and response.usage_metadata else None
    return {"output": response.text, "latency_ms": latency, "tokens_used": tokens, "cost_usd": _cost(model_name, tokens), "error": None}


async def _run_oa(client, model, prompt, start):
    response = await client.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}])
    latency = int((time.time() - start) * 1000)
    tokens = response.usage.total_tokens if response.usage else None
    return {"output": response.choices[0].message.content, "latency_ms": latency, "tokens_used": tokens, "cost_usd": 0.0, "error": None}


async def _run_anthropic(client, model_name, prompt, start):
    response = await client.messages.create(model=model_name, max_tokens=1024, messages=[{"role": "user", "content": prompt}])
    latency = int((time.time() - start) * 1000)
    tokens = (response.usage.input_tokens + response.usage.output_tokens) if response.usage else None
    return {"output": response.content[0].text if response.content else None, "latency_ms": latency, "tokens_used": tokens, "cost_usd": 0.0, "error": None}


def _cost(model, tokens):
    if not tokens: return 0.0
    rates = {"gemini-2.5-flash": 0.000015, "gemini-2.0-flash": 0.00001875, "gemini-1.5-flash": 0.000007}
    return round((tokens / 1000) * rates.get(model, 0.0), 6)


def _error(msg, start):
    return {"output": None, "latency_ms": int((time.time() - start) * 1000), "tokens_used": None, "cost_usd": None, "error": msg}