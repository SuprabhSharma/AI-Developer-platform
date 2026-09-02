"""Selects the AIProvider implementation based on settings.AI_PROVIDER."""
from app.ai.provider import AIProvider
from app.ai.providers.gemini import GeminiProvider
from app.ai.providers.groq import GroqProvider
from app.ai.providers.mock import MockProvider
from app.ai.providers.ollama import OllamaProvider
from app.core.config import settings

_PROVIDERS = {
    "mock": lambda: MockProvider(),
    "gemini": lambda: GeminiProvider(),
    "groq": lambda: GroqProvider(),
    "ollama": lambda: OllamaProvider(),
}


def get_ai_provider() -> AIProvider:
    factory = _PROVIDERS.get(settings.AI_PROVIDER)
    if not factory:
        raise ValueError(f"Unknown AI_PROVIDER '{settings.AI_PROVIDER}'")
    if settings.AI_PROVIDER != "mock" and settings.AI_PROVIDER != "ollama" and not settings.AI_API_KEY:
        # Fail safe to mock rather than crash the whole app when a key is missing.
        return MockProvider()
    return factory()
