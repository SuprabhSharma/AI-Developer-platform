"""Authenticated SSE chat endpoint backed by each provider's native stream."""
import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.factory import get_ai_provider
from app.core.deps import get_current_organization, get_current_user
from app.core.redis import enforce_ai_rate_limit, get_redis
from app.db.session import get_db
from app.models.user import Organization, User
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.project_repository import ProjectRepository
from app.schemas.chat import ChatStreamRequest
from app.services.ai_service import AIService
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects/{project_id}/chat", tags=["chat"])


def _event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


async def _build_stream(
    project_id: uuid.UUID,
    user: User,
    org: Organization,
    db: AsyncSession,
    redis,
    message: str,
    conversation_id: uuid.UUID | None,
    action: Literal["chat", "explain_code", "generate_tests", "generate_code"],
    code: str | None,
    path: str | None,
) -> StreamingResponse:
    await ProjectService(ProjectRepository(db)).get_project_or_404(project_id, org.id)
    service = AIService(get_ai_provider(), ConversationRepository(db), db)
    prompt = message.strip()
    if action == "explain_code":
        prompt = prompt or f"Explain {path or 'this file'}"
    elif action == "generate_tests":
        prompt = prompt or f"Generate tests for {path or 'this file'}"
    elif action == "generate_code":
        prompt = prompt or "Generate the requested code"
    if not prompt:
        raise HTTPException(422, "Message is required")
    if action in {"explain_code", "generate_tests"} and not code:
        raise HTTPException(422, "Code is required for this AI action")
    await enforce_ai_rate_limit(redis, user.id, project_id)

    if action == "chat":
        try:
            resolved_conversation_id, token_stream = await service.stream_chat(
                project_id, user.id, conversation_id, prompt
            )
        except ValueError as error:
            raise HTTPException(404, str(error)) from error

        async def event_generator():
            yield _event("meta", {"conversation_id": str(resolved_conversation_id)})
            try:
                async for token in token_stream:
                    yield _event("token", {"token": token})
                yield _event("done", {"conversation_id": str(resolved_conversation_id)})
            except Exception as error:  # noqa: BLE001 - stream errors are sent as SSE events
                yield _event("error", {"error": str(error)})

    else:
        try:
            resolved_conversation_id, response = await service.capability(
                project_id, user.id, conversation_id, action, prompt, code
            )
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except RuntimeError as error:
            raise HTTPException(502, str(error)) from error

        async def event_generator():
            yield _event("meta", {"conversation_id": str(resolved_conversation_id)})
            yield _event("token", {"token": response.content})
            yield _event("done", {"conversation_id": str(resolved_conversation_id)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/stream")
async def stream_chat(
    project_id: uuid.UUID,
    message: str = Query(..., min_length=1, max_length=8000),
    conversation_id: uuid.UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    return await _build_stream(project_id, user, org, db, redis, message, conversation_id, "chat", None, None)


@router.post("/stream")
async def stream_action(
    project_id: uuid.UUID,
    payload: ChatStreamRequest,
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    return await _build_stream(
        project_id,
        user,
        org,
        db,
        redis,
        payload.message,
        payload.conversation_id,
        payload.action,
        payload.code,
        payload.path,
    )
