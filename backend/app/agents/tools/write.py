"""Approval-gated filesystem write tools for the coding agent."""
import inspect
from collections.abc import Awaitable, Callable
from pathlib import Path

from app.agents.tools.base import Tool, ToolResult
from app.agents.tools.read_only import _safe_join

ApprovalValidator = Callable[[str], bool | Awaitable[bool]]


async def _approved(token: str, validator: ApprovalValidator | None) -> bool:
    if not token or validator is None:
        return False
    result = validator(token)
    return await result if inspect.isawaitable(result) else result


class WriteFileTool(Tool):
    name = "write_file"
    description = "Write complete text content to a workspace-relative file after approval."
    input_schema = {
        "type": "object",
        "properties": {"path": {"type": "string"}, "content": {"type": "string"}, "approval_token": {"type": "string"}},
        "required": ["path", "content", "approval_token"],
    }

    def __init__(self, workspace_root: Path, approval_validator: ApprovalValidator | None = None):
        self.workspace_root = workspace_root
        self.approval_validator = approval_validator

    async def execute(self, path: str, content: str, approval_token: str = "") -> ToolResult:
        if not await _approved(approval_token, self.approval_validator):
            return ToolResult(success=False, error="Approval required")
        try:
            target = _safe_join(self.workspace_root, path)
            if target.exists() and target.is_dir():
                return ToolResult(success=False, error=f"Not a file: {path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            return ToolResult(success=True, data={"path": path, "content": content})
        except (OSError, ValueError) as exc:
            return ToolResult(success=False, error=str(exc))


class EditFileTool(WriteFileTool):
    name = "edit_file"
    description = "Replace text in a workspace-relative file after approval."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string"}, "old_content": {"type": "string"},
            "new_content": {"type": "string"}, "approval_token": {"type": "string"},
        },
        "required": ["path", "new_content", "approval_token"],
    }

    async def execute(
        self, path: str, old_content: str | None = None, new_content: str | None = None,
        approval_token: str = "", content: str | None = None,
    ) -> ToolResult:
        if not await _approved(approval_token, self.approval_validator):
            return ToolResult(success=False, error="Approval required")
        try:
            target = _safe_join(self.workspace_root, path)
            if not target.is_file():
                return ToolResult(success=False, error=f"Not a file: {path}")
            current = target.read_text(encoding="utf-8", errors="replace")
            replacement = new_content if new_content is not None else content
            if replacement is None:
                return ToolResult(success=False, error="new_content is required")
            if old_content is not None:
                if old_content not in current:
                    return ToolResult(success=False, error="Text to replace was not found")
                replacement = current.replace(old_content, replacement, 1)
            target.write_text(replacement, encoding="utf-8")
            return ToolResult(success=True, data={"path": path, "content": replacement})
        except (OSError, ValueError) as exc:
            return ToolResult(success=False, error=str(exc))
