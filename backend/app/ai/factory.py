"""Selects the AIProvider implementation: Groq / Grok (with Mock fallback for tests)."""
from app.ai.provider import AIProvider
from app.ai.providers.groq import GroqProvider
from app.ai.providers.mock import MockProvider
from app.core.config import settings

_PROVIDERS = {
    "groq": lambda: GroqProvider(),
    "grok": lambda: GroqProvider(),
    "mock": lambda: MockProvider(),
}


def get_ai_provider() -> AIProvider:
    if settings.AI_PROVIDER == "mock" or not settings.AI_API_KEY:
        return MockProvider()
    provider_creator = _PROVIDERS.get(settings.AI_PROVIDER.lower(), lambda: GroqProvider())
    return provider_creator()

