"""
Orchestrates chat: loads conversation history, calls the configured AIProvider,
persists messages, and records usage. Routes/agents never call a provider directly.
"""
import time
import uuid

from app.ai.provider import AIProvider, ChatMessage
from app.models.conversation import Conversation, Message, MessageRole
from app.models.usage import AIRequest, AIRequestStatus
from app.repositories.conversation_repository import ConversationRepository


class AIService:
    def __init__(self, provider: AIProvider, conversation_repo: ConversationRepository, db):
        self.provider = provider
        self.conversation_repo = conversation_repo
        self.db = db  # used only to persist AIRequest usage rows

    async def chat(
        self, project_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID | None, user_message: str
    ) -> tuple[uuid.UUID, Message]:
        if conversation_id:
            conversation = await self.conversation_repo.get_with_messages(conversation_id)
            if not conversation:
                raise ValueError("Conversation not found")
        else:
            conversation = await self.conversation_repo.create(
                Conversation(project_id=project_id, user_id=user_id, title=user_message[:60])
            )

        await self.conversation_repo.add_message(
            Message(conversation_id=conversation.id, role=MessageRole.USER, content=user_message)
        )

        history = [ChatMessage(role="user", content=user_message)]
        start = time.perf_counter()
        try:
            response = await self.provider.chat(history)
            status_ = AIRequestStatus.SUCCESS
            error_message = None
        except Exception as e:  # noqa: BLE001 - AI calls can fail in many vendor-specific ways
            status_ = AIRequestStatus.FAILED
            error_message = str(e)
            response = None
        latency_ms = int((time.perf_counter() - start) * 1000)

        self.db.add(
            AIRequest(
                user_id=user_id,
                project_id=project_id,
                provider=self.provider.name,
                model=getattr(response, "model", "unknown"),
                input_tokens=response.usage.input_tokens if response else None,
                output_tokens=response.usage.output_tokens if response else None,
                latency_ms=latency_ms,
                estimated_cost_usd=response.usage.estimated_cost_usd if response else None,
                status=status_,
                error_message=error_message,
            )
        )

        if not response:
            raise RuntimeError(f"AI provider error: {error_message}")

        assistant_message = await self.conversation_repo.add_message(
            Message(conversation_id=conversation.id, role=MessageRole.ASSISTANT, content=response.content)
        )
        return conversation.id, assistant_message
