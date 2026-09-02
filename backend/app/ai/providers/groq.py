"""GroqProvider - OpenAI-compatible chat completions adapter for Groq and Grok."""
import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage
from app.core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"

# Active chat models verified on Groq API
GROQ_FALLBACK_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b",
    "groq/compound-mini",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]

# Any of these in Groq's error message means "bad / decommissioned / unsupported model ID"
_MODEL_ERROR_KEYWORDS = (
    "not found",
    "does not exist",
    "invalid model",
    "decommissioned",
    "deprecated",
    "no longer supported",
    "unsupported model",
    "model_not_found",
    "has been decommissioned",
)


def _normalize_model(model_name: str | None) -> str:
    """Normalize model names, replacing decommissioned or placeholder models with active defaults."""
    if not model_name:
        return DEFAULT_GROQ_MODEL
    clean = model_name.strip().strip("'\"")
    # Clean old openrouter/openai prefixes if leftovers exist
    if clean.lower().startswith("openrouter/"):
        clean = clean[len("openrouter/"):]
    if clean.endswith(":free"):
        clean = clean[:-len(":free")]
    # Replace decommissioned or placeholder models
    decommissioned_or_placeholders = {
        "default",
        "auto",
        "openrouter/auto",
        "llama3-70b-8192",
        "llama3-8b-8192",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
        "llama-3.3-70b-versatile",  # Map if user's account only has the new gpt-oss/qwen suite
        "",
    }
    if clean.lower() in decommissioned_or_placeholders:
        return DEFAULT_GROQ_MODEL
    return clean


class GroqProvider(AIProvider):
    """Call Groq / Grok without adding an SDK dependency.

    Automatically retries with active models if a model is unavailable or decommissioned.
    """

    name = "groq"

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        endpoint: str | None = None,
    ):
        raw_key = api_key or settings.AI_API_KEY or ""
        self.api_key = raw_key.strip().strip("'\"")
        configured_model = model or settings.AI_MODEL
        self.model = _normalize_model(configured_model)
        self.endpoint = (
            endpoint
            or getattr(settings, "GROQ_ENDPOINT", None)
            or DEFAULT_GROQ_ENDPOINT
        )
        self.last_usage: AIUsage = AIUsage()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _messages(messages: list[ChatMessage]) -> list[dict[str, str]]:
        return [{"role": message.role, "content": message.content} for message in messages]

    def _payload(self, messages: list[ChatMessage], model: str | None = None, stream: bool = False) -> dict:
        payload: dict = {
            "model": model or self.model,
            "messages": self._messages(messages),
            "max_tokens": settings.AI_AGENT_MAX_TOKENS,
        }
        if stream:
            payload["stream"] = True
        return payload

    @staticmethod
    def _usage(data: dict) -> AIUsage:
        raw = data.get("usage") or {}
        return AIUsage(
            input_tokens=raw.get("prompt_tokens"),
            output_tokens=raw.get("completion_tokens"),
            estimated_cost_usd=0.0,
        )

    @staticmethod
    def _is_model_not_found(status_code: int, body: str) -> bool:
        """Return True when the response means the model ID is wrong, decommissioned, or not found."""
        if status_code in (400, 404, 422):
            msg = body.lower()
            try:
                err = json.loads(body)
                msg = str(err.get("error", {}).get("message", "")).lower()
            except Exception:
                pass
            if any(kw in msg for kw in _MODEL_ERROR_KEYWORDS):
                return True
        return False

    def _format_http_error(self, status_code: int, body: str, model: str) -> RuntimeError:
        if status_code == 429:
            return RuntimeError(
                "Groq Rate Limit Exceeded (429): Too many requests. Please wait and try again."
            )
        if status_code == 401:
            return RuntimeError(
                "Groq Authentication Failed (401): Invalid API key. "
                "Check AI_API_KEY in backend/.env."
            )
        try:
            err_data = json.loads(body)
            if "error" in err_data:
                msg = err_data["error"].get("message") or str(err_data["error"])
                return RuntimeError(f"Groq API error ({status_code}): {msg}")
        except Exception:
            pass
        return RuntimeError(f"Groq API error ({status_code}): {body[:200]}")

    def _fallback_models_for(self, preferred: str) -> list[str]:
        """Return ordered models to try: preferred first, then the rest of GROQ_FALLBACK_MODELS."""
        result = [preferred]
        for m in GROQ_FALLBACK_MODELS:
            if m != preferred:
                result.append(m)
        return result

    async def chat(self, messages: list[ChatMessage]) -> AIResponse:
        for model in self._fallback_models_for(self.model):
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    self.endpoint,
                    headers=self._headers(),
                    json=self._payload(messages, model=model),
                )
                body = response.text
                if self._is_model_not_found(response.status_code, body):
                    logger.warning("Groq: model '%s' unavailable (HTTP %s), trying next fallback...", model, response.status_code)
                    continue
                if response.status_code >= 400:
                    raise self._format_http_error(response.status_code, body, model)
                data = response.json()
                actual_model = data.get("model") or model
                self.model = actual_model
                result = AIResponse(
                    content=data["choices"][0]["message"]["content"],
                    model=actual_model,
                    usage=self._usage(data),
                )
                self.last_usage = result.usage
                logger.info("Groq: used model '%s'", actual_model)
                return result
        raise RuntimeError(
            f"Groq: No working model found. Tried: {self._fallback_models_for(self.model)}. "
            "Check https://console.groq.com/docs/models for current model IDs."
        )

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Stream Groq's OpenAI-compatible SSE response with automatic model fallback."""
        self.last_usage = AIUsage()
        last_error: RuntimeError | None = None

        for model in self._fallback_models_for(self.model):
            try:
                found_working = False
                async with httpx.AsyncClient(timeout=60.0) as client:
                    async with client.stream(
                        "POST",
                        self.endpoint,
                        headers=self._headers(),
                        json=self._payload(messages, model=model, stream=True),
                    ) as response:
                        if response.status_code >= 400:
                            body_bytes = await response.aread()
                            body = body_bytes.decode(errors="replace")
                            if self._is_model_not_found(response.status_code, body):
                                logger.warning(
                                    "Groq: model '%s' unavailable (HTTP %s), trying next fallback...",
                                    model, response.status_code
                                )
                                last_error = self._format_http_error(response.status_code, body, model)
                                continue
                            raise self._format_http_error(response.status_code, body, model)

                        found_working = True
                        self.model = model
                        async for line in response.aiter_lines():
                            if not line or not line.startswith("data:"):
                                continue
                            raw = line[5:].strip()
                            if raw == "[DONE]":
                                return
                            try:
                                data = json.loads(raw)
                            except json.JSONDecodeError:
                                continue
                            if data.get("model"):
                                self.model = data["model"]
                            if data.get("usage"):
                                self.last_usage = self._usage(data)
                            choices = data.get("choices", [])
                            delta = choices[0].get("delta", {}) if choices else {}
                            text = delta.get("content", "") or ""
                            if text:
                                yield text
                if found_working:
                    return
            except RuntimeError:
                raise
            except Exception as exc:
                raise RuntimeError(f"Groq streaming error: {exc}") from exc

        raise last_error or RuntimeError(
            f"Groq: No working model found. Tried: {self._fallback_models_for(self.model)}. "
            "Check https://console.groq.com/docs/models for current model IDs."
        )

    async def generate_code(self, prompt: str, context: str | None = None) -> AIResponse:
        return await self.chat([
            ChatMessage(
                role="system",
                content="You are an expert software engineer. Return production-ready code and brief implementation notes.",
            ),
            ChatMessage(role="user", content=f"{prompt}\n\nExisting context:\n{context or '(none)'}"),
        ])

    async def explain_code(self, code: str) -> AIResponse:
        return await self.chat([
            ChatMessage(
                role="system",
                content="You explain code accurately. Mention control flow, dependencies, edge cases, and security concerns without inventing behavior.",
            ),
            ChatMessage(role="user", content=f"Explain this code:\n\n{code}"),
        ])

    async def generate_tests(self, code: str) -> AIResponse:
        return await self.chat([
            ChatMessage(
                role="system",
                content="You write focused, executable tests. Infer the framework from the code and state assumptions briefly.",
            ),
            ChatMessage(role="user", content=f"Generate tests for this code:\n\n{code}"),
        ])
