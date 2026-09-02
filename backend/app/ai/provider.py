"""
The AIProvider interface. Nothing outside app/ai/ should ever import a vendor
SDK (google-generativeai, groq, etc) directly — services depend on this
interface, and app/ai/factory.py decides which concrete provider to hand them
based on settings.AI_PROVIDER. This is what makes switching providers a
one-file change instead of an application-wide rewrite.
"""
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant" | "system"
    content: str


@dataclass
class AIUsage:
    """
    Not every provider reports identical accounting info (e.g. local Ollama
    models may not report cost). All fields are optional so AIRequest rows
    degrade gracefully per-provider instead of assuming a shared schema.
    """
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None


@dataclass
class AIResponse:
    content: str
    model: str
    usage: AIUsage = field(default_factory=AIUsage)


class AIProvider(ABC):
    """Every concrete provider (Mock, Gemini, Groq, ...) implements this."""

    name: str = "base"
    # Providers update this after a streaming call. Provider instances are
    # request-scoped, so the value is safe for the streaming usage recorder.
    last_usage: AIUsage | None = None

    @abstractmethod
    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        """Single-shot chat completion."""
        raise NotImplementedError

    @abstractmethod
    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Yield response text incrementally, for SSE token streaming."""
        raise NotImplementedError
        yield ""  # pragma: no cover - makes this an async generator for type checkers

    # --- Provider capabilities used by the workspace actions. ---

    async def generate_code(self, prompt: str, context: str | None = None) -> AIResponse:
        raise NotImplementedError("generate_code is not implemented by this provider")

    async def explain_code(self, code: str) -> AIResponse:
        raise NotImplementedError("explain_code is not implemented by this provider")

    async def analyze_code(self, code: str) -> AIResponse:
        raise NotImplementedError("analyze_code is implemented in Phase 4+ (repository-aware analysis)")

    async def generate_tests(self, code: str) -> AIResponse:
        raise NotImplementedError("generate_tests is not implemented by this provider")


def estimate_cost_usd(
    usage: AIUsage,
    input_cost_per_million: float,
    output_cost_per_million: float,
) -> float | None:
    """Return a transparent estimate when a provider reports token counts."""
    if usage.input_tokens is None and usage.output_tokens is None:
        return None
    input_cost = (usage.input_tokens or 0) * input_cost_per_million / 1_000_000
    output_cost = (usage.output_tokens or 0) * output_cost_per_million / 1_000_000
    return round(input_cost + output_cost, 8)
