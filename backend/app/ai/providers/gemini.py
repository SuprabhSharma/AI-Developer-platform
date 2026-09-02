"""
GeminiProvider — thin adapter over Google's Gemini API.
HTTP calls only; kept intentionally small since the provider *interface*
(app/ai/provider.py) is what the rest of the app relies on, not this file.
"""
from collections.abc import AsyncIterator

import httpx

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage
from app.core.config import settings

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiProvider(AIProvider):
    name = "gemini"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or settings.AI_API_KEY
        self.model = model if model and model != "default" else "gemini-1.5-flash"

    def _to_gemini_contents(self, messages: list[ChatMessage]) -> list[dict]:
        return [{"role": "user" if m.role != "assistant" else "model", "parts": [{"text": m.content}]} for m in messages]

    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        url = GEMINI_ENDPOINT.format(model=self.model)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                params={"key": self.api_key},
                json={"contents": self._to_gemini_contents(messages)},
            )
            resp.raise_for_status()
            data = resp.json()

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        usage_meta = data.get("usageMetadata", {})
        return AIResponse(
            content=text,
            model=self.model,
            usage=AIUsage(
                input_tokens=usage_meta.get("promptTokenCount"),
                output_tokens=usage_meta.get("candidatesTokenCount"),
            ),
        )

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        # Simplification for Phase 1: fetch full response, then yield in chunks.
        # True token-level SSE streaming from Gemini's streamGenerateContent
        # endpoint is a Phase 3 follow-up once chat is wired end-to-end.
        response = await self.chat(messages)
        for chunk in [response.content[i : i + 40] for i in range(0, len(response.content), 40)]:
            yield chunk
