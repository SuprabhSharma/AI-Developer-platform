"""
Non-streaming chat endpoint. Streaming (SSE) variant lives in chat_stream.py —
split out so this endpoint stays simple for clients that don't need SSE.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.factory import get_ai_provider
from app.core.deps import get_current_organization, get_current_user
from app.core.redis import enforce_ai_rate_limit, get_redis
from app.db.session import get_db
from app.models.user import Organization, User
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.project_repository import ProjectRepository
from app.schemas.chat import ChatRequest, ChatResponse, MessageRead
from app.services.ai_service import AIService
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def chat(
    project_id: uuid.UUID,
    payload: ChatRequest,
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    await ProjectService(ProjectRepository(db)).get_project_or_404(project_id, org.id)
    await enforce_ai_rate_limit(redis, user.id, project_id)

    service = AIService(get_ai_provider(), ConversationRepository(db), db)
    try:
        conversation_id, message = await service.chat(project_id, user.id, payload.conversation_id, payload.message)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    await db.commit()
    return ChatResponse(conversation_id=conversation_id, message=MessageRead.model_validate(message))
