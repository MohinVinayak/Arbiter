import time
import asyncio
import google.generativeai as genai
from openai import AsyncOpenAI
from app.config import settings

# Configure Gemini
genai.configure(api_key=settings.GEMINI_API_KEY)

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

SUPPORTED_MODELS = [
    "gemini-2.0-flash",
    "groq/llama-3.3-70b-versatile",
    "groq/llama-3.1-8b-instant",
    "github/gpt-4o-mini",
]

async def run_llm(model: str, prompt: str) -> dict:
    start = time.time()
    try:
        if model.startswith("gemini"):
            return await _run_gemini(prompt, start)
        elif model.startswith("groq/"):
            return await _run_openai_compatible(
                groq_client, model.replace("groq/", ""), prompt, start
            )
        elif model.startswith("github/"):
            return await _run_openai_compatible(
                github_client, model.replace("github/", ""), prompt, start
            )
        else:
            # Everything else goes through OpenRouter
            return await _run_openai_compatible(
                openrouter_client, model, prompt, start
            )
    except Exception as e:
        return _error_result(str(e), start)


async def _run_gemini(prompt: str, start: float) -> dict:
    # Use gemini-2.0-flash to avoid 404 on older models
    model = genai.GenerativeModel("gemini-2.0-flash")
    response = await asyncio.to_thread(model.generate_content, prompt)
    latency = int((time.time() - start) * 1000)
    tokens = response.usage_metadata.total_token_count if response.usage_metadata else None
    return {
        "output": response.text,
        "latency_ms": latency,
        "tokens_used": tokens,
        "cost_usd": _estimate_cost("gemini-2.0-flash", tokens),
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


def _estimate_cost(model: str, tokens: int | None) -> float:
    if not tokens:
        return 0.0
    rates = {
        "gemini-1.5-flash": 0.0,
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