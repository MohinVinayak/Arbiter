import time
import asyncio
import anthropic
from google import genai
from openai import AsyncOpenAI
from app.config import settings

# Configure Gemini
gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY) if settings.GEMINI_API_KEY else None

# OpenAI-compatible clients — only created when a key is present
openrouter_client = (
    AsyncOpenAI(api_key=settings.OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")
    if settings.OPENROUTER_API_KEY else None
)

groq_client = (
    AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
    if settings.GROQ_API_KEY else None
)

github_client = (
    AsyncOpenAI(api_key=settings.GITHUB_TOKEN, base_url="https://models.inference.ai.azure.com")
    if settings.GITHUB_TOKEN else None
)

anthropic_client = (
    anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    if settings.ANTHROPIC_API_KEY else None
)

deepseek_client = (
    AsyncOpenAI(api_key=settings.DEEPSEEK_API_KEY, base_url="https://api.deepseek.com/v1")
    if settings.DEEPSEEK_API_KEY else None
)

try:
    from mistralai import Mistral
    mistral_client = (
        Mistral(api_key=settings.MISTRAL_API_KEY)
        if settings.MISTRAL_API_KEY else None
    )
except ImportError:
    mistral_client = None

SUPPORTED_MODELS = [
    "google/gemini-2.0-flash",
    "groq/llama-3.3-70b-versatile",
    "groq/llama-3.1-8b-instant",
    "github/gpt-4o-mini",
    "anthropic/claude-3-haiku-20240307",
    "mistral/mistral-large-latest",
    "mistral/mistral-small-latest",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-reasoner",
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
            if not groq_client:
                return _error_result("Groq API key not configured", start)
            return await _run_openai_compatible(groq_client, model.replace("groq/", ""), prompt, start)
        elif model.startswith("github/"):
            if not github_client:
                return _error_result("GitHub token not configured", start)
            return await _run_openai_compatible(github_client, model.replace("github/", ""), prompt, start)
        elif model.startswith("anthropic/"):
            if not anthropic_client:
                return _error_result("Anthropic API key not configured", start)
            return await _run_anthropic(model.replace("anthropic/", ""), prompt, start)
        elif model.startswith("deepseek/"):
            if not deepseek_client:
                return _error_result("DeepSeek API key not configured", start)
            return await _run_openai_compatible(deepseek_client, model.replace("deepseek/", ""), prompt, start)
        elif model.startswith("mistral/"):
            if not mistral_client:
                return _error_result("Mistral API key not configured", start)
            return await _run_mistral(model.replace("mistral/", ""), prompt, start)
        else:
            if not openrouter_client:
                return _error_result("OpenRouter API key not configured", start)
            return await _run_openai_compatible(openrouter_client, model, prompt, start)
    except Exception as e:
        logger.error(f"   [FAIL] LLM API: {model} - {str(e)}")
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


async def _run_mistral(model_name: str, prompt: str, start: float) -> dict:
    if not mistral_client:
        return _error_result("Mistral API key not configured", start)
    
    response = await asyncio.to_thread(
        mistral_client.chat.complete,
        model=model_name,
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