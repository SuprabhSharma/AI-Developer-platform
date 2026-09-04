"""REST + SSE endpoints for Jupyter notebook cell execution."""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.services import kernel_service, sandbox_service
from app.core.deps import get_current_user
from app.models.user import User
from app.db.session import get_db
from app.repositories.project_repository import ProjectRepository

router = APIRouter(prefix="/projects/{project_id}", tags=["execution"])
logger = logging.getLogger(__name__)


import uuid
from sqlalchemy import select
from app.models.project import Workspace
from app.models.user import Membership

async def _workspace(project_id: str, user: User, db: AsyncSession) -> str:
    try:
        pid = uuid.UUID(str(project_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "Invalid project ID")

    repo = ProjectRepository(db)
    project = await repo.get_by_id(pid)
    if not project:
        raise HTTPException(404, "Project not found")

    if project.owner_id != user.id:
        result = await db.execute(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.organization_id == project.organization_id,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(403, "Access forbidden to this project")

    if not project.workspaces:
        workspace = await repo.create_workspace(Workspace(project_id=project.id, name="main"))
        await db.commit()
        return str(workspace.id)

    return str(project.workspaces[0].id)


class ExecuteRequest(BaseModel):
    code: str
    cell_index: int = 0


@router.post("/kernel/start")
async def start_kernel(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    wid = await _workspace(project_id, user, db)
    path = kernel_service.resolve_workspace_path(wid)
    await kernel_service.get_or_start_kernel(project_id, path)
    return {"status": "running"}


@router.post("/kernel/execute")
async def execute_cell(
    project_id: str,
    body: ExecuteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SSE stream of CellOutput JSON objects."""
    wid = await _workspace(project_id, user, db)
    path = kernel_service.resolve_workspace_path(wid)
    await kernel_service.get_or_start_kernel(project_id, path)

    async def stream():
        try:
            async for output in kernel_service.execute_cell(project_id, body.code):
                yield f"data: {json.dumps(output)}\n\n"
        except Exception as e:
            logger.exception("Error executing cell: %s", e)
            yield f"data: {json.dumps({'output_type': 'error', 'ename': type(e).__name__, 'evalue': str(e), 'traceback': []})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/kernel")
async def stop_kernel(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _workspace(project_id, user, db)
    await kernel_service.shutdown_kernel(project_id)
    return {"status": "stopped"}


@router.post("/terminal/stop")
async def stop_terminal(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _workspace(project_id, user, db)
    await sandbox_service.stop_sandbox(project_id)
    return {"status": "stopped"}
