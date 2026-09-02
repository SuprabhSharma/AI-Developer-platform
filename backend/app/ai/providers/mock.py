"""
MockProvider — lets the entire application run with zero AI API keys.
Used as the default AI_PROVIDER so a fresh `docker compose up` works out of
the box, and in tests so CI never depends on external network/API keys.
"""
import asyncio
from collections.abc import AsyncIterator

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage


class MockProvider(AIProvider):
    name = "mock"

    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        reply = (
            f"[mock-ai] I received your message: \"{last_user[:200]}\". "
            "Configure AI_PROVIDER and AI_API_KEY to talk to a real model."
        )
        return AIResponse(
            content=reply,
            model="mock-1",
            usage=AIUsage(input_tokens=len(last_user.split()), output_tokens=len(reply.split()), estimated_cost_usd=0.0),
        )

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        response = await self.chat(messages)
        for word in response.content.split(" "):
            yield word + " "
            await asyncio.sleep(0.02)
