"""Tool interface for the future coding agent. Phase 1 ships read-only tools only."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class ToolResult:
    success: bool
    data: Any = None
    error: str | None = None


class Tool(ABC):
    name: str
    description: str
    input_schema: dict  # JSON schema for the tool's arguments

    @abstractmethod
    async def execute(self, **kwargs) -> ToolResult:
        raise NotImplementedError
