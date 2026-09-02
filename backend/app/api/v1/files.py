"""
File tree browse/read/write, scoped to a project's default workspace.
Phase 1 assumes one workspace per project (see ProjectService.create_project).
"""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_organization
from app.db.session import get_db
from app.integrations.storage.factory import get_storage_provider
from app.models.user import Organization
from app.repositories.file_repository import FileRepository
from app.repositories.project_repository import ProjectRepository
from app.schemas.file import (
    FileContentResponse,
    FileNode,
    FileTreeResponse,
    FileUploadResponse,
    FileWriteRequest,
    FolderCreateRequest,
    RenameRequest,
)
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


@router.post("/folders", response_model=FileNode, status_code=status.HTTP_201_CREATED)
@router.post("/folder", response_model=FileNode, status_code=status.HTTP_201_CREATED)
async def create_folder(
    project_id: uuid.UUID,
    payload: FolderCreateRequest,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    record = await service.create_folder(workspace_id, payload.path)
    await db.commit()
    return FileNode(path=record.path, file_type=record.file_type.value, size_bytes=record.size_bytes)


@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_files(
    project_id: uuid.UUID,
    files: list[UploadFile] = File(default=[]),
    paths: list[str] = Form(default=[]),
    directories: list[str] = Form(default=[]),
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one file is required")
    if paths and len(paths) != len(files):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Each uploaded file must have one relative path")
    uploads = [(paths[index] if paths else (upload.filename or ""), await upload.read()) for index, upload in enumerate(files)]
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    records = await service.upload_files(workspace_id, uploads, directories)
    await db.commit()
    return FileUploadResponse(
        items=[FileNode(path=record.path, file_type=record.file_type.value, size_bytes=record.size_bytes) for record in records],
        total=len(records),
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


@router.patch("/{file_path:path}", response_model=FileNode)
async def rename_file(
    project_id: uuid.UUID,
    file_path: str,
    payload: RenameRequest,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    record = await service.rename_path(workspace_id, file_path, payload.new_path)
    await db.commit()
    return FileNode(path=record.path, file_type=record.file_type.value, size_bytes=record.size_bytes)


@router.delete("/{file_path:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    project_id: uuid.UUID,
    file_path: str,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
):
    workspace_id = await _workspace_id(project_id, org, db)
    service = FileService(FileRepository(db), get_storage_provider())
    await service.delete_path(workspace_id, file_path)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
