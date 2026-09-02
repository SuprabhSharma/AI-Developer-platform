import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.factory import get_ai_provider
from app.ai.provider import ChatMessage
from app.core.deps import get_current_organization, get_current_user
from app.db.session import get_db
from app.models.user import Organization, User
from app.repositories.project_repository import ProjectRepository
from app.schemas.agent import (
    AgentContinueRequest,
    AgentDirectRequest,
    AgentExecuteResponse,
    AgentPlanRead,
    AgentPlanRequest,
    PlanStepRead,
)
from app.services.agent_service import AgentService
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects/{project_id}/agent", tags=["agent"])


def _event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"



async def _owned_plan(project_id: uuid.UUID, plan_id: uuid.UUID, org: Organization, db: AsyncSession):
    await ProjectService(ProjectRepository(db)).get_project_or_404(project_id, org.id)
    service = AgentService(db)
    try:
        plan = await service.get_plan(plan_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    if plan.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return service, plan


async def _owned_step(service: AgentService, plan, step_id: uuid.UUID):
    try:
        step = await service.get_step(step_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    if step.plan_id != plan.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Step not found")
    return step


def _read(plan) -> AgentPlanRead:
    return AgentPlanRead.model_validate({
        "id": plan.id, "project_id": plan.project_id, "user_id": plan.user_id,
        "task_description": plan.task_description, "status": plan.status,
        "created_at": plan.created_at, "steps": plan.steps, "run": plan.runs[0] if plan.runs else None,
    })


@router.post("/plan", response_model=AgentPlanRead, status_code=status.HTTP_201_CREATED)
async def create_plan(
    project_id: uuid.UUID, payload: AgentPlanRequest,
    user: User = Depends(get_current_user), org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    await ProjectService(ProjectRepository(db)).get_project_or_404(project_id, org.id)
    try:
        service = AgentService(db)
        plan = await service.create_plan(project_id, user.id, payload.task_description)
        await db.commit()
        return _read(await service.get_plan(plan.id))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.get("/plan/{plan_id}", response_model=AgentPlanRead)
async def get_plan(project_id: uuid.UUID, plan_id: uuid.UUID, org: Organization = Depends(get_current_organization), db: AsyncSession = Depends(get_db)):
    service, plan = await _owned_plan(project_id, plan_id, org, db)
    return _read(await service.get_plan(plan.id))


@router.post("/plan/{plan_id}/steps/{step_id}/approve", response_model=PlanStepRead)
async def approve_step(project_id: uuid.UUID, plan_id: uuid.UUID, step_id: uuid.UUID, org: Organization = Depends(get_current_organization), db: AsyncSession = Depends(get_db)):
    service, plan = await _owned_plan(project_id, plan_id, org, db)
    try:
        await _owned_step(service, plan, step_id)
        step = await service.approve_step(step_id)
        await db.commit()
        return step
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/plan/{plan_id}/steps/{step_id}/reject", response_model=PlanStepRead)
async def reject_step(project_id: uuid.UUID, plan_id: uuid.UUID, step_id: uuid.UUID, org: Organization = Depends(get_current_organization), db: AsyncSession = Depends(get_db)):
    service, plan = await _owned_plan(project_id, plan_id, org, db)
    try:
        await _owned_step(service, plan, step_id)
        step = await service.reject_step(step_id)
        await db.commit()
        return step
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/plan/{plan_id}/steps/{step_id}/execute", response_model=AgentExecuteResponse)
async def execute_step(project_id: uuid.UUID, plan_id: uuid.UUID, step_id: uuid.UUID, org: Organization = Depends(get_current_organization), db: AsyncSession = Depends(get_db)):
    service, plan = await _owned_plan(project_id, plan_id, org, db)
    try:
        await _owned_step(service, plan, step_id)
        step = await service.execute_step(step_id)
        current = await service.get_plan(plan.id)
        await db.commit()
        return {"step": step, "logs": current.runs[0].logs, "result": service.last_result}
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/plan/{plan_id}/continue", response_model=AgentPlanRead)
async def continue_plan(project_id: uuid.UUID, plan_id: uuid.UUID, payload: AgentContinueRequest, org: Organization = Depends(get_current_organization), db: AsyncSession = Depends(get_db)):
    service, plan = await _owned_plan(project_id, plan_id, org, db)
    try:
        next_plan = await service.continue_plan(plan.id, payload.context)
        await db.commit()
        return _read(await service.get_plan(next_plan.id))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.post("/stream")
async def stream_agent(
    project_id: uuid.UUID,
    payload: AgentDirectRequest,
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    await ProjectService(ProjectRepository(db)).get_project_or_404(project_id, org.id)
    provider = get_ai_provider()

    system_prompt = (
        "You are an expert AI code assistant inside an IDE like VS Code or Cursor.\n"
        "Your task: write, edit, refactor, or explain code based on the user's prompt and active workspace context.\n"
        "Guidelines:\n"
        "1. Write clean, idiomatic, production-ready code matching the language and framework of the project.\n"
        "2. When writing or modifying code for the active file, output the updated complete code inside a markdown code block with the language tag (e.g. ```typescript ... ``` or ```python ... ```).\n"
        "3. Keep any conversational commentary concise and relevant.\n"
        "4. Follow existing conventions, imports, and style shown in the file context."
    )

    context_lines = []
    if payload.workspace_files:
        clean_files = [f for f in payload.workspace_files if not f.startswith(".")][:50]
        context_lines.append(f"Workspace file tree:\n{', '.join(clean_files)}")

    if payload.active_file:
        context_lines.append(f"Active file: {payload.active_file}")
        if payload.file_content is not None and payload.file_content.strip():
            # Send up to 15,000 characters to conserve tokens while providing full file context
            content_snippet = payload.file_content[:15000]
            context_lines.append(f"Current content of {payload.active_file}:\n```\n{content_snippet}\n```")
        else:
            context_lines.append(f"Active file {payload.active_file} is currently empty.")
    else:
        context_lines.append("No active file currently open.")

    user_text = f"{'\n\n'.join(context_lines)}\n\nUser request:\n{payload.prompt}"

    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_text),
    ]

    async def event_generator():
        yield _event("meta", {"active_file": payload.active_file})
        try:
            async for token in provider.stream_chat(messages):
                yield _event("token", {"token": token})
            yield _event("done", {"active_file": payload.active_file})
        except Exception as exc:
            yield _event("error", {"error": str(exc)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

