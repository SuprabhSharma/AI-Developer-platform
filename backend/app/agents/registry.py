"""Tool registry the agent consults to discover/execute available tools by name."""
from pathlib import Path

from app.agents.tools.base import Tool, ToolResult
from app.agents.tools.read_only import ListFilesTool, ReadFileTool, SearchFilesTool
from app.agents.tools.write import ApprovalValidator, EditFileTool, WriteFileTool


class ToolRegistry:
    def __init__(self, workspace_root: Path, approval_validator: ApprovalValidator | None = None):
        self._tools: dict[str, Tool] = {}
        tools = (
            ListFilesTool(workspace_root), ReadFileTool(workspace_root), SearchFilesTool(workspace_root),
            WriteFileTool(workspace_root, approval_validator), EditFileTool(workspace_root, approval_validator),
        )
        for tool in tools:
            self.register(tool)

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def list_tools(self) -> list[dict]:
        return [{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in self._tools.values()]

    async def execute(self, name: str, **kwargs) -> ToolResult:
        tool = self.get(name)
        if not tool:
            return ToolResult(success=False, error=f"Unknown tool: {name}")
        return await tool.execute(**kwargs)
