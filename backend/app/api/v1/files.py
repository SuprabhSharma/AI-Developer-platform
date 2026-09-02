"""
File tree browse/read/write, scoped to a project's default workspace.
Phase 1 assumes one workspace per project (see ProjectService.create_project).
"""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_organization
from app.db.session import get_db
from app.integrations.storage.factory import get_storage_provider
from app.models.user import Organization
from app.repositories.file_repository import FileRepository
from app.repositories.project_repository import ProjectRepository
from app.schemas.file import FileContentResponse, FileNode, FileTreeResponse, FileWriteRequest
from app.services.file_service import FileService
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects/{project_id}/files", tags=["files"])


async def _workspace_id(project_id: uuid.UUID, org: Organization, db: AsyncSession) -> uuid.UUID:
    project = await ProjectService(ProjectRepository(db)).get_project_or_404(project_id, org.id)
    return project.workspaces[0].id


@router.get("", response_model=FileTreeResponse)
async def list_files(
    project_id: uuid.UUID,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    records = await service.list_tree(workspace_id)
    return FileTreeResponse(
        items=[FileNode(path=r.path, file_type=r.file_type.value, size_bytes=r.size_bytes) for r in records]
    )


@router.get("/{file_path:path}", response_model=FileContentResponse)
async def read_file(
    project_id: uuid.UUID,
    file_path: str,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    content = await service.read_file(workspace_id, file_path)
    return FileContentResponse(path=file_path, content=content, size_bytes=len(content.encode()))


@router.put("/{file_path:path}", response_model=FileContentResponse)
async def write_file(
    project_id: uuid.UUID,
    file_path: str,
    payload: FileWriteRequest,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    record = await service.write_file(workspace_id, file_path, payload.content)
    await db.commit()
    return FileContentResponse(path=record.path, content=payload.content, size_bytes=record.size_bytes)
