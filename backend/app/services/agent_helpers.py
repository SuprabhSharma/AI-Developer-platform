"""Pure helpers for parsing and previewing agent plans."""
import json
import re

from app.models.agent import PlanStep

ALLOWED_TOOLS = {"read_file", "search_files", "write_file", "edit_file"}
TOOL_ALIASES = {"read": "read_file", "search": "search_files", "write": "write_file", "edit": "edit_file"}
DEFAULT_FALLBACK_QUERY = "Find files relevant to the requested task"


def preview_step(step: PlanStep, before: str) -> str:
    data = step.tool_input
    if step.tool_name == "write_file":
        return str(data.get("content", ""))
    replacement = data.get("new_content", data.get("content"))
    old = data.get("old_content")
    if old is not None and old in before:
        return before.replace(old, replacement, 1)
    return str(replacement) if replacement is not None else before


def _fallback_plan(task: str) -> list[dict]:
    query = task.strip()[:200] or DEFAULT_FALLBACK_QUERY
    return [{
        "tool_name": "search_files",
        "tool_input": {"query": query},
        "description": "Search the workspace for context related to the task",
    }]


def parse_plan(content: str | None, fallback_query: str | None = None) -> list[dict]:
    """Parse a model response into executable plan steps.

    Planning models do not always follow the requested JSON shape exactly. A
    safe workspace search is preferable to rejecting the entire agent request
    when the model returns an empty response or an empty plan.
    """
    raw = (content or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
    start, end = raw.find("["), raw.rfind("]")
    try:
        payload = json.loads(raw[start:end + 1] if start >= 0 and end > start else raw)
    except json.JSONDecodeError:
        return _fallback_plan(fallback_query or DEFAULT_FALLBACK_QUERY)
    if isinstance(payload, dict):
        if "tool_name" in payload:
            payload = [payload]
        else:
            payload = payload.get("steps", payload.get("plan", []))
    if not isinstance(payload, list) or not payload:
        return _fallback_plan(fallback_query or DEFAULT_FALLBACK_QUERY)
    parsed = []
    for item in payload:
        if not isinstance(item, dict):
            return _fallback_plan(fallback_query or DEFAULT_FALLBACK_QUERY)
        tool_name = TOOL_ALIASES.get(item.get("tool_name"), item.get("tool_name"))
        tool_input = item.get("tool_input")
        if tool_name == "search_files" and isinstance(tool_input, dict) and "query" not in tool_input:
            search_term = tool_input.get("pattern") or tool_input.get("search") or fallback_query or DEFAULT_FALLBACK_QUERY
            tool_input = {"query": str(search_term)[:200]}
        if tool_name not in ALLOWED_TOOLS or not isinstance(tool_input, dict):
            return _fallback_plan(fallback_query or DEFAULT_FALLBACK_QUERY)
        parsed.append({"tool_name": tool_name, "tool_input": tool_input, "description": str(item.get("description", ""))})
    return parsed
