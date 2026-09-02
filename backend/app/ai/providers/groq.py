"""GroqProvider — OpenAI-compatible chat completions adapter."""
from collections.abc import AsyncIterator

import httpx

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage
from app.core.config import settings

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"


class GroqProvider(AIProvider):
    name = "groq"

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or settings.AI_API_KEY
        self.model = model if model and model != "default" else "llama-3.1-8b-instant"

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
        usage = data.get("usage", {})
        return AIResponse(
            content=choice,
            model=self.model,
            usage=AIUsage(input_tokens=usage.get("prompt_tokens"), output_tokens=usage.get("completion_tokens")),
        )

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        response = await self.chat(messages)
        for chunk in [response.content[i : i + 40] for i in range(0, len(response.content), 40)]:
            yield chunk
