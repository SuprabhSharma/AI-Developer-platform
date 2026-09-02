"""Data-access layer for Conversation/Message."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.conversation import Conversation, Message


class ConversationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, conversation: Conversation) -> Conversation:
        self.db.add(conversation)
        await self.db.flush()
        return conversation

    async def get_with_messages(self, conversation_id: uuid.UUID) -> Conversation | None:
        result = await self.db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .options(selectinload(Conversation.messages))
        )
        return result.scalar_one_or_none()

    async def add_message(self, message: Message) -> Message:
        self.db.add(message)
        await self.db.flush()
        return message
