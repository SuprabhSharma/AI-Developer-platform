"""GroqProvider - OpenAI-compatible chat completions adapter."""
import json
from collections.abc import AsyncIterator

import httpx

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage, estimate_cost_usd
from app.core.config import settings

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"


class GroqProvider(AIProvider):
    name = "groq"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or settings.AI_API_KEY
        configured_model = model or settings.AI_MODEL
        self.model = configured_model if configured_model != "default" else "llama-3.1-8b-instant"

    def _usage(self, data: dict) -> AIUsage:
        raw = data.get("usage", {})
        usage = AIUsage(input_tokens=raw.get("prompt_tokens"), output_tokens=raw.get("completion_tokens"))
        usage.estimated_cost_usd = estimate_cost_usd(usage, 0.05, 0.08)
        return usage

    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                },
            )
            resp.raise_for_status()
            data = resp.json()

        choice = data["choices"][0]["message"]["content"]
        response = AIResponse(content=choice, model=self.model, usage=self._usage(data))
        self.last_usage = response.usage
        return response

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Stream Groq's native OpenAI-compatible SSE response."""
        self.last_usage = AIUsage()
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "stream": True,
                    "stream_options": {"include_usage": True},
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if data.get("usage"):
                        self.last_usage = self._usage(data)
                    choices = data.get("choices", [])
                    delta = choices[0].get("delta", {}) if choices else {}
                    text = delta.get("content", "") or ""
                    if text:
                        yield text

    async def generate_code(self, prompt: str, context: str | None = None) -> AIResponse:
        return await self.chat([
            ChatMessage(role="system", content="You are a careful software engineer. Return production-ready code and brief implementation notes."),
            ChatMessage(role="user", content=f"{prompt}\n\nExisting context:\n{context or '(none)'}"),
        ])

    async def explain_code(self, code: str) -> AIResponse:
        return await self.chat([
            ChatMessage(role="system", content="You explain code accurately. Mention control flow, dependencies, edge cases, and security concerns without inventing behavior."),
            ChatMessage(role="user", content=f"Explain this code:\n\n{code}"),
        ])

    async def generate_tests(self, code: str) -> AIResponse:
        return await self.chat([
            ChatMessage(role="system", content="You write focused, executable tests. Infer the framework from the code and state assumptions briefly."),
            ChatMessage(role="user", content=f"Generate tests for this code:\n\n{code}"),
        ])
