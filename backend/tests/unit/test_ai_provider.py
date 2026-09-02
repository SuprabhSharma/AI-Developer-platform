import pytest

from app.ai.provider import ChatMessage
from app.ai.providers.mock import MockProvider


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
