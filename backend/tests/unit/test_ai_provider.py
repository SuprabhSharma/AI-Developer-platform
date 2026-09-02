import json

import httpx
import pytest

from app.ai.factory import get_ai_provider
from app.ai.provider import ChatMessage
from app.ai.providers import groq as groq_module
from app.ai.providers.groq import GroqProvider
from app.ai.providers.mock import MockProvider
from app.core.config import settings


@pytest.mark.asyncio
async def test_mock_provider_chat():
    provider = MockProvider()
    response = await provider.chat([ChatMessage(role="user", content="hello")])
    assert "hello" in response.content
    assert response.model == "mock-1"


@pytest.mark.asyncio
async def test_mock_provider_stream():
    provider = MockProvider()
    chunks = [c async for c in provider.stream_chat([ChatMessage(role="user", content="hi")])]
    assert "".join(chunks).strip() != ""


def test_groq_provider_defaults():
    from app.ai.providers.groq import GROQ_FALLBACK_MODELS
    provider = GroqProvider(api_key="test-key")

    assert provider.name == "groq"
    assert provider.api_key == "test-key"
    assert provider.model == GROQ_FALLBACK_MODELS[0]
    assert provider.endpoint == "https://api.groq.com/openai/v1/chat/completions"


def test_factory_creates_groq_provider(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "groq")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")

    provider = get_ai_provider()

    assert isinstance(provider, GroqProvider)
    assert provider.api_key == "test-key"


def test_factory_creates_grok_alias(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "grok")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")

    provider = get_ai_provider()

    assert isinstance(provider, GroqProvider)
    assert provider.api_key == "test-key"


@pytest.mark.asyncio
async def test_groq_provider_uses_chat_completions_api(monkeypatch):
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers["Authorization"]
        captured["body"] = request.content
        return httpx.Response(
            200,
            json={
                "model": "llama-3.3-70b-versatile",
                "choices": [{"message": {"content": "Hello from Groq"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 4},
            },
        )

    transport = httpx.MockTransport(handler)
    async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return async_client(*args, **kwargs)

    monkeypatch.setattr(groq_module.httpx, "AsyncClient", client_factory)

    provider = GroqProvider(api_key="test-key", model="openai/gpt-oss-120b")
    response = await provider.chat([
        ChatMessage(role="system", content="You are a coding agent planner."),
        ChatMessage(role="user", content="hello"),
    ])

    assert captured["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert captured["authorization"] == "Bearer test-key"
    payload = json.loads(captured["body"])
    assert payload["model"] == "openai/gpt-oss-120b"
    assert payload["max_tokens"] == settings.AI_AGENT_MAX_TOKENS
    assert response.content == "Hello from Groq"
    assert response.model == "llama-3.3-70b-versatile"
    assert response.usage.input_tokens == 3
    assert response.usage.output_tokens == 4
