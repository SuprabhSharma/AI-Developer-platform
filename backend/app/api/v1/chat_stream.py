"""SSE token-streaming chat endpoint, kept separate from chat.py's request/response JSON endpoint."""
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.factory import get_ai_provider
from app.ai.provider import ChatMessage
from app.core.deps import get_current_organization
from app.db.session import get_db
from app.models.user import Organization

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["chat"])


@router.get("/stream")
async def stream_chat(
    project_id: uuid.UUID,
    message: str,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    provider = get_ai_provider()

    async def event_generator():
        async for chunk in provider.stream_chat([ChatMessage(role="user", content=message)]):
            yield f"data: {chunk}\n\n"
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
