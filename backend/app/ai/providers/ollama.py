"""OllamaProvider — talks to a locally running Ollama instance. No API key needed."""
from collections.abc import AsyncIterator

import httpx

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage

OLLAMA_ENDPOINT = "http://localhost:11434/api/chat"


class OllamaProvider(AIProvider):
    name = "ollama"

    def __init__(self, model: str | None = None):
        self.model = model if model and model != "default" else "llama3"

    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                OLLAMA_ENDPOINT,
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        return AIResponse(content=data["message"]["content"], model=self.model, usage=AIUsage())

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        response = await self.chat(messages)
        yield response.content
