"""Orchestration for chat, streamed chat, AI actions, and usage accounting."""
import time
import uuid
from collections.abc import AsyncIterator

from app.ai.provider import AIProvider, AIResponse, AIUsage, ChatMessage
from app.models.conversation import Conversation, Message, MessageRole
from app.models.usage import AIRequest, AIRequestStatus
from app.repositories.conversation_repository import ConversationRepository


class AIService:
    def __init__(self, provider: AIProvider, conversation_repo: ConversationRepository, db):
        self.provider = provider
        self.conversation_repo = conversation_repo
        self.db = db

    async def _prepare(
        self,
        project_id: uuid.UUID,
        user_id: uuid.UUID,
        conversation_id: uuid.UUID | None,
        user_message: str,
    ) -> tuple[Conversation, list[ChatMessage]]:
        if conversation_id:
            conversation = await self.conversation_repo.get_with_messages(conversation_id)
            if (
                not conversation
                or conversation.project_id != project_id
                or conversation.user_id != user_id
            ):
                raise ValueError("Conversation not found")
        else:
            conversation = await self.conversation_repo.create(
                Conversation(project_id=project_id, user_id=user_id, title=user_message[:60])
            )

        user_record = Message(conversation_id=conversation.id, role=MessageRole.USER, content=user_message)
        await self.conversation_repo.add_message(user_record)
        # Existing conversations are loaded with selectinload. A newly-created
        # conversation has no loaded relationship yet; reading it here would
        # trigger an async-incompatible lazy load under SQLAlchemy asyncio.
        history = list(conversation.messages) if conversation_id else []
        history.append(user_record)
        role_map = {
            MessageRole.USER: "user",
            MessageRole.ASSISTANT: "assistant",
            MessageRole.SYSTEM: "system",
            MessageRole.TOOL: "user",
        }
        return conversation, [ChatMessage(role=role_map[m.role], content=m.content) for m in history]

    def _record_request(
        self,
        user_id: uuid.UUID,
        project_id: uuid.UUID,
        response: AIResponse | None,
        latency_ms: int,
        status: AIRequestStatus,
        error_message: str | None = None,
    ) -> None:
        usage = response.usage if response else AIUsage()
        self.db.add(
            AIRequest(
                user_id=user_id,
                project_id=project_id,
                provider=self.provider.name,
                model=getattr(response, "model", getattr(self.provider, "model", "unknown")),
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                latency_ms=latency_ms,
                estimated_cost_usd=usage.estimated_cost_usd,
                status=status,
                error_message=error_message,
            )
        )

    async def chat(
        self, project_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID | None, user_message: str
    ) -> tuple[uuid.UUID, Message]:
        conversation, history = await self._prepare(project_id, user_id, conversation_id, user_message)
        start = time.perf_counter()
        try:
            response = await self.provider.chat(history)
            status_ = AIRequestStatus.SUCCESS
            error_message = None
        except Exception as error:  # noqa: BLE001 - vendor failures are recorded for usage diagnostics
            response = None
            status_ = AIRequestStatus.FAILED
            error_message = str(error)

        self._record_request(user_id, project_id, response, int((time.perf_counter() - start) * 1000), status_, error_message)
        if not response:
            await self.db.commit()
            raise RuntimeError(f"AI provider error: {error_message}")

        assistant_message = await self.conversation_repo.add_message(
            Message(conversation_id=conversation.id, role=MessageRole.ASSISTANT, content=response.content)
        )
        await self.db.commit()
        return conversation.id, assistant_message

    async def stream_chat(
        self, project_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID | None, user_message: str
    ) -> tuple[uuid.UUID, AsyncIterator[str]]:
        """Prepare a conversation and return an iterator that records its result."""
        conversation, history = await self._prepare(project_id, user_id, conversation_id, user_message)
        # A StreamingResponse begins sending after this method returns. Some ASGI
        # servers close request-scoped dependencies at that point, which would roll
        # back the freshly-created conversation and user message before the token
        # generator runs. Persist them now, then retain the resolved ID for the
        # assistant message and the SSE metadata event.
        resolved_conversation_id = conversation.id
        await self.db.commit()

        async def generate() -> AsyncIterator[str]:
            chunks: list[str] = []
            start = time.perf_counter()
            try:
                async for chunk in self.provider.stream_chat(history):
                    chunks.append(chunk)
                    yield chunk
                usage = getattr(self.provider, "last_usage", AIUsage())
                response = AIResponse(content="".join(chunks), model=getattr(self.provider, "model", "unknown"), usage=usage)
                await self.conversation_repo.add_message(
                    Message(conversation_id=resolved_conversation_id, role=MessageRole.ASSISTANT, content=response.content)
                )
                self._record_request(
                    user_id,
                    project_id,
                    response,
                    int((time.perf_counter() - start) * 1000),
                    AIRequestStatus.SUCCESS,
                )
                await self.db.commit()
            except Exception as error:  # noqa: BLE001 - preserve the stream error for the client and usage table
                self._record_request(
                    user_id,
                    project_id,
                    None,
                    int((time.perf_counter() - start) * 1000),
                    AIRequestStatus.FAILED,
                    str(error),
                )
                await self.db.commit()
                raise RuntimeError(f"AI provider error: {error}") from error

        return resolved_conversation_id, generate()

    async def capability(
        self,
        project_id: uuid.UUID,
        user_id: uuid.UUID,
        conversation_id: uuid.UUID | None,
        action: str,
        prompt: str,
        code: str | None = None,
    ) -> tuple[uuid.UUID, AIResponse]:
        """Run a provider capability and persist it as a normal conversation turn."""
        conversation, _ = await self._prepare(project_id, user_id, conversation_id, prompt)
        start = time.perf_counter()
        try:
            if action == "explain_code":
                response = await self.provider.explain_code(code or "")
            elif action == "generate_tests":
                response = await self.provider.generate_tests(code or "")
            elif action == "generate_code":
                response = await self.provider.generate_code(prompt, code)
            else:
                raise ValueError("Unknown AI action")
        except Exception as error:  # noqa: BLE001
            self._record_request(
                user_id,
                project_id,
                None,
                int((time.perf_counter() - start) * 1000),
                AIRequestStatus.FAILED,
                str(error),
            )
            await self.db.commit()
            raise RuntimeError(f"AI provider error: {error}") from error

        await self.conversation_repo.add_message(
            Message(conversation_id=conversation.id, role=MessageRole.ASSISTANT, content=response.content)
        )
        self._record_request(
            user_id,
            project_id,
            response,
            int((time.perf_counter() - start) * 1000),
            AIRequestStatus.SUCCESS,
        )
        await self.db.commit()
        return conversation.id, response
