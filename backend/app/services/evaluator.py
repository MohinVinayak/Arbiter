import re
from app.services.llm_runner import run_llm


def run_deterministic_checks(output: str, checks: list) -> dict:
    """Run rule-based checks: length, substring, JSON, and regex."""
    if not checks or not output:
        return {"score": None, "details": []}
    results = [_run_single_check(output, c) for c in checks]
    score = round(sum(1 for r in results if r["passed"]) / len(results), 2)
    return {"score": score, "details": results}


def _run_single_check(output: str, check: dict) -> dict:
    t, v, passed = check.get("type"), check.get("value"), False
    if   t == "max_length":       passed = len(output) <= int(v)
    elif t == "min_length":       passed = len(output) >= int(v)
    elif t == "must_contain":     passed = v.lower() in output.lower()
    elif t == "must_not_contain": passed = v.lower() not in output.lower()
    elif t == "starts_with":      passed = output.strip().startswith(v)
    elif t == "is_json":
        try:
            import json
            json.loads(output)
            passed = True
        except Exception:
            passed = False
    elif t == "regex_match":      passed = bool(re.search(v, output))
    return {"check": t, "value": v, "passed": passed}


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


async def run_llm_judge(
    prompt: str,
    output: str,
    expected: str = None,
    judge_model: str = "google/gemini-2.0-flash",
    resolved: dict = None,
) -> dict:
    """Score model response quality using an LLM judge."""
    if not output:
        return {"score": 0.0, "reasoning": "No output to evaluate"}

    expected_section = f"Expected/Reference answer:\n{expected}\n" if expected else ""
    judge_input = (
        JUDGE_PROMPT
        .replace("{prompt}", prompt)
        .replace("{output}", output)
        .replace("{expected_section}", expected_section)
    )

    result = await run_llm(judge_model, judge_input, resolved=resolved)
    if result["error"]:
        return {"score": None, "reasoning": f"Judge failed: {result['error']}"}
    return _parse_judge_response(result["output"])


def _parse_judge_response(response: str) -> dict:
    try:
        score_line = next(l for l in response.split("\n") if l.startswith("SCORE:"))
        reasoning_line = next(l for l in response.split("\n") if l.startswith("REASONING:"))
        score = float(score_line.replace("SCORE:", "").strip())
        reasoning = reasoning_line.replace("REASONING:", "").strip()
        return {"score": round(score, 2), "reasoning": reasoning}
    except Exception:
        return {"score": None, "reasoning": "Could not parse judge response"}


def compute_overall_score(deterministic: float | None, judge: float | None) -> float | None:
    """
    Weighted 2-tier score: 70% Judge reasoning + 30% Deterministic checks.
    Returns available score if one tier is omitted.
    """
    if deterministic is not None and judge is not None:
        return round((deterministic * 0.3) + (judge * 0.7), 4)
    if deterministic is not None:
        return round(deterministic, 4)
    if judge is not None:
        return round(judge, 4)
    return None
