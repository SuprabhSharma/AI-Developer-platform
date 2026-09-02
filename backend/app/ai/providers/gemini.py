"""
GeminiProvider — thin adapter over Google's Gemini API.
HTTP calls only; kept intentionally small since the provider *interface*
(app/ai/provider.py) is what the rest of the app relies on, not this file.
"""
import json
from collections.abc import AsyncIterator

import httpx

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage, estimate_cost_usd
from app.core.config import settings

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_STREAM_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"


class GeminiProvider(AIProvider):
    name = "gemini"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or settings.AI_API_KEY
        configured_model = model or settings.AI_MODEL
        self.model = configured_model if configured_model != "default" else "gemini-1.5-flash"

    def _to_gemini_contents(self, messages: list[ChatMessage]) -> list[dict]:
        return [
            {"role": "user" if m.role != "assistant" else "model", "parts": [{"text": m.content}]}
            for m in messages
            if m.role != "system"
        ]

    def _payload(self, messages: list[ChatMessage]) -> dict:
        payload = {"contents": self._to_gemini_contents(messages)}
        system = [m.content for m in messages if m.role == "system"]
        if system:
            payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system)}]}
        return payload

    @staticmethod
    def _text_from_chunk(data: dict) -> str:
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        return "".join(part.get("text", "") for part in parts if isinstance(part, dict))

    @staticmethod
    def _usage(data: dict) -> AIUsage:
        metadata = data.get("usageMetadata", {})
        usage = AIUsage(
            input_tokens=metadata.get("promptTokenCount"),
            output_tokens=metadata.get("candidatesTokenCount"),
        )
        usage.estimated_cost_usd = estimate_cost_usd(usage, 0.075, 0.30)
        return usage

    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        url = GEMINI_ENDPOINT.format(model=self.model)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                params={"key": self.api_key},
                json=self._payload(messages),
            )
            resp.raise_for_status()
            data = resp.json()

        response = AIResponse(content=self._text_from_chunk(data), model=self.model, usage=self._usage(data))
        self.last_usage = response.usage
        return response

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Stream Gemini's native `streamGenerateContent` SSE response."""
        self.last_usage = AIUsage()
        url = GEMINI_STREAM_ENDPOINT.format(model=self.model)
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                url,
                params={"key": self.api_key, "alt": "sse"},
                json=self._payload(messages),
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
                    self.last_usage = self._usage(data)
                    text = self._text_from_chunk(data)
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
