import re
from app.services.llm_runner import run_llm

# Lazy singleton — loaded once on first semantic score call
_sentence_model = None

def _get_sentence_model():
    global _sentence_model
    if _sentence_model is None:
        from sentence_transformers import SentenceTransformer
        _sentence_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _sentence_model

# ─────────────────────────────────────────────
# LAYER 1: Deterministic Checks
# ─────────────────────────────────────────────

def run_deterministic_checks(output: str, checks: list) -> dict:
    """
    Run rule-based checks on output.
    Returns: { score: float, details: list }
    """
    if not checks or not output:
        return {"score": None, "details": []}

    results = []
    for check in checks:
        result = _run_single_check(output, check)
        results.append(result)

    passed = sum(1 for r in results if r["passed"])
    score = round(passed / len(results), 2)
    return {"score": score, "details": results}


def _run_single_check(output: str, check: dict) -> dict:
    check_type = check.get("type")
    value = check.get("value")
    passed = False

    if check_type == "max_length":
        passed = len(output) <= int(value)

    elif check_type == "min_length":
        passed = len(output) >= int(value)

    elif check_type == "must_contain":
        passed = value.lower() in output.lower()

    elif check_type == "must_not_contain":
        passed = value.lower() not in output.lower()

    elif check_type == "starts_with":
        passed = output.strip().startswith(value)

    elif check_type == "is_json":
        try:
            import json
            json.loads(output)
            passed = True
        except Exception:
            passed = False

    elif check_type == "regex_match":
        passed = bool(re.search(value, output))

    return {"check": check_type, "value": value, "passed": passed}


# ─────────────────────────────────────────────
# LAYER 2: Semantic Similarity
# ─────────────────────────────────────────────

def compute_semantic_score(output: str, expected: str) -> float | None:
    """
    Compute cosine similarity between output and expected using sentence-transformers.
    Returns float 0-1, or None if no expected output provided.
    """
    if not expected or not output:
        return None

    try:
        from sklearn.metrics.pairwise import cosine_similarity
        model = _get_sentence_model()
        embeddings = model.encode([output, expected])
        score = cosine_similarity([embeddings[0]], [embeddings[1]])[0][0]
        return round(float(score), 4)
    except Exception as e:
        import logging
        logging.getLogger("uvicorn.error").warning(f"Semantic scoring failed: {e}")
        return None


# ─────────────────────────────────────────────
# LAYER 3: LLM-as-Judge
# ─────────────────────────────────────────────

JUDGE_PROMPT = """You are an impartial evaluator. Score the following AI response on a scale of 0.0 to 1.0.

Task/Prompt given to AI:
{prompt}

AI Response:
{output}

{expected_section}

Scoring criteria:
- 1.0: Perfect response, fully meets requirements
- 0.7-0.9: Good response with minor issues  
- 0.4-0.6: Partial response, significant gaps
- 0.1-0.3: Poor response, mostly misses the mark
- 0.0: Completely wrong or harmful

Respond in this exact format:
SCORE: <number between 0.0 and 1.0>
REASONING: <one sentence explanation>"""


async def run_llm_judge(prompt: str, output: str, expected: str = None, judge_model: str = "google/gemini-2.0-flash") -> dict:
    """
    Use an LLM to judge output quality.
    Returns: { score: float, reasoning: str }
    """
    if not output:
        return {"score": 0.0, "reasoning": "No output to evaluate"}

    expected_section = ""
    if expected:
        expected_section = f"Expected/Reference answer:\n{expected}\n"

    judge_input = JUDGE_PROMPT.replace(
        "{prompt}", prompt
    ).replace(
        "{output}", output
    ).replace(
        "{expected_section}", expected_section
    )

    result = await run_llm(judge_model, judge_input)

    if result["error"]:
        return {"score": None, "reasoning": f"Judge failed: {result['error']}"}

    return _parse_judge_response(result["output"])


def _parse_judge_response(response: str) -> dict:
    try:
        score_line = [l for l in response.split("\n") if l.startswith("SCORE:")][0]
        reasoning_line = [l for l in response.split("\n") if l.startswith("REASONING:")][0]
        score = float(score_line.replace("SCORE:", "").strip())
        reasoning = reasoning_line.replace("REASONING:", "").strip()
        return {"score": round(score, 2), "reasoning": reasoning}
    except Exception:
        return {"score": None, "reasoning": "Could not parse judge response"}


# ─────────────────────────────────────────────
# Combined Score
# ─────────────────────────────────────────────

def compute_overall_score(deterministic: float, semantic: float, judge: float) -> float:
    """
    Weighted average of all three scoring layers.
    Skips layers that returned None.
    """
    scores = []
    weights = []

    if deterministic is not None:
        scores.append(deterministic)
        weights.append(0.4)   # 40% weight

    if semantic is not None:
        scores.append(semantic)
        weights.append(0.3)   # 30% weight

    if judge is not None:
        scores.append(judge)
        weights.append(0.3)   # 30% weight

    if not scores:
        return None

    total_weight = sum(weights)
    weighted = sum(s * w for s, w in zip(scores, weights))
    return round(weighted / total_weight, 4)
