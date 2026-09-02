"""
Read-only filesystem tools, sandboxed to a workspace's storage root.
No tool in this module can write, delete, or execute anything — write/execute
tools are intentionally deferred to Phase 5/6 behind sandboxed workers.
"""
from pathlib import Path

from app.agents.tools.base import Tool, ToolResult
from app.core.config import settings


def _safe_join(root: Path, relative_path: str) -> Path:
    """Resolve relative_path under root, rejecting any path-traversal attempt."""
    candidate = (root / relative_path).resolve()
    if root not in candidate.parents and candidate != root:
        raise ValueError("Path escapes workspace root")
    return candidate


class ListFilesTool(Tool):
    name = "list_files"
    description = "List files and directories under a given relative path in the workspace."
    input_schema = {"type": "object", "properties": {"path": {"type": "string", "default": "."}}}

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    async def execute(self, path: str = ".") -> ToolResult:
        try:
            target = _safe_join(self.workspace_root, path)
            if not target.exists():
                return ToolResult(success=False, error=f"Path not found: {path}")
            entries = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())
            return ToolResult(success=True, data=entries)
        except ValueError as e:
            return ToolResult(success=False, error=str(e))


class ReadFileTool(Tool):
    name = "read_file"
    description = "Read the text content of a single file in the workspace (capped at MAX_FILE_READ_BYTES)."
    input_schema = {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    async def execute(self, path: str) -> ToolResult:
        try:
            target = _safe_join(self.workspace_root, path)
            if not target.is_file():
                return ToolResult(success=False, error=f"Not a file: {path}")
            if target.stat().st_size > settings.MAX_FILE_READ_BYTES:
                return ToolResult(success=False, error="File exceeds max read size")
            return ToolResult(success=True, data=target.read_text(errors="replace"))
        except ValueError as e:
            return ToolResult(success=False, error=str(e))


class SearchFilesTool(Tool):
    name = "search_files"
    description = "Search for a substring across text files in the workspace."
    input_schema = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}

    def __init__(self, workspace_root: Path, max_results: int = 50):
        self.workspace_root = workspace_root
        self.max_results = max_results

    async def execute(self, query: str) -> ToolResult:
        matches = []
        for file_path in self.workspace_root.rglob("*"):
            if len(matches) >= self.max_results:
                break
            if not file_path.is_file():
                continue
            try:
                text = file_path.read_text(errors="ignore")
            except Exception:
                continue
            if query in text:
                rel = file_path.relative_to(self.workspace_root)
                line_no = next((i + 1 for i, line in enumerate(text.splitlines()) if query in line), None)
                matches.append({"path": str(rel), "line": line_no})
        return ToolResult(success=True, data=matches)
