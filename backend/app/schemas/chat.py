import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: uuid.UUID | None = None


class MessageRead(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message: MessageRead


class ChatStreamRequest(BaseModel):
    message: str = Field(default="", max_length=8000)
    conversation_id: uuid.UUID | None = None
    action: Literal["chat", "explain_code", "generate_tests", "generate_code"] = "chat"
    code: str | None = Field(default=None, max_length=200_000)
    path: str | None = Field(default=None, max_length=2048)
