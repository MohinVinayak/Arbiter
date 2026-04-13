import time
import asyncio
import anthropic
from google import genai
from openai import AsyncOpenAI
from app.config import settings

# Configure Gemini
gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY) if settings.GEMINI_API_KEY else None

# OpenAI-compatible clients
openrouter_client = AsyncOpenAI(
    api_key=settings.OPENROUTER_API_KEY,
    base_url="https://openrouter.ai/api/v1"
)

groq_client = AsyncOpenAI(
    api_key=settings.GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
)

github_client = AsyncOpenAI(
    api_key=settings.GITHUB_TOKEN,
    base_url="https://models.inference.ai.azure.com"
)

anthropic_client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

SUPPORTED_MODELS = [
    "google/gemini-2.0-flash",
    "groq/llama-3.3-70b-versatile",
    "groq/llama-3.1-8b-instant",
    "github/gpt-4o-mini",
    "anthropic/claude-3-haiku-20240307",
]

import logging
logger = logging.getLogger("uvicorn.error")

async def run_llm(model: str, prompt: str) -> dict:
    start = time.time()
    try:
        logger.info(f"   -> Calling LLM API: {model}")
        if model.startswith("google/"):
            return await _run_gemini(model.replace("google/", ""), prompt, start)
        elif model.startswith("groq/"):
            return await _run_openai_compatible(groq_client, model.replace("groq/", ""), prompt, start)
        elif model.startswith("github/"):
            return await _run_openai_compatible(github_client, model.replace("github/", ""), prompt, start)
        elif model.startswith("anthropic/"):
            return await _run_anthropic(model.replace("anthropic/", ""), prompt, start)
        else:
            return await _run_openai_compatible(openrouter_client, model, prompt, start)
    except Exception as e:
        logger.error(f"   ❌ Failed LLM API: {model} - {str(e)}")
        return _error_result(str(e), start)



async def _run_gemini(model_name: str, prompt: str, start: float) -> dict:
    if not gemini_client:
        return _error_result("Gemini API key not configured", start)
    
    response = await asyncio.to_thread(
        gemini_client.models.generate_content,
        model=model_name,
        contents=prompt
    )
    latency = int((time.time() - start) * 1000)
    tokens = response.usage_metadata.total_token_count if (hasattr(response, 'usage_metadata') and response.usage_metadata) else None
    return {
        "output": response.text,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": _estimate_cost(model_name, tokens),
        "error": None
    }


async def _run_openai_compatible(client, model: str, prompt: str, start: float) -> dict:
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    latency = int((time.time() - start) * 1000)
    tokens = response.usage.total_tokens if response.usage else None
    return {
        "output": response.choices[0].message.content,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": 0.0,
        "error": None
    }


async def _run_anthropic(model_name: str, prompt: str, start: float) -> dict:
    response = await anthropic_client.messages.create(
        model=model_name,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    latency = int((time.time() - start) * 1000)
    tokens = response.usage.input_tokens + response.usage.output_tokens if response.usage else None
    return {
        "output": response.content[0].text if response.content else None,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": 0.0,
        "error": None
    }


def _estimate_cost(model: str, tokens: int | None) -> float:
    if not tokens:
        return 0.0
    rates = {
        "gemini-2.0-flash": 0.00001875,  # $0.075 per 1M input tokens (approx blended)
        "gemini-1.5-flash": 0.000007,
    }
    return round((tokens / 1000) * rates.get(model, 0.0), 6)


def _error_result(error: str, start: float) -> dict:
    return {
        "output": None,
        "latency_ms": int((time.time() - start) * 1000),
        "tokens_used": None,
        "cost_usd": None,
        "error": error
    }


async def run_parallel(model_list: list, prompt: str) -> dict:
    """Run same prompt across all selected models in parallel"""
    tasks = [run_llm(model, prompt) for model in model_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return dict(zip(model_list, results))