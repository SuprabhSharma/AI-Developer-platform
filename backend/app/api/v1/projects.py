import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_organization, get_current_user
from app.db.session import get_db
from app.models.user import Organization, User
from app.repositories.project_repository import ProjectRepository
from app.schemas.project import ProjectCreate, ProjectListResponse, ProjectRead
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects", tags=["projects"])


def _service(db: AsyncSession = Depends(get_db)) -> ProjectService:
    return ProjectService(ProjectRepository(db))


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org: Organization = Depends(get_current_organization),
    service: ProjectService = Depends(_service),
):
    items, total = await service.list_projects(org.id, page, page_size)
    return ProjectListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=ProjectRead, status_code=201)
async def create_project(
    payload: ProjectCreate,
    user: User = Depends(get_current_user),
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
    service: ProjectService = Depends(_service),
):
    project = await service.create_project(org.id, user.id, payload)
    await db.commit()
    return project


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: uuid.UUID,
    org: Organization = Depends(get_current_organization),
    service: ProjectService = Depends(_service),
):
    return await service.get_project_or_404(project_id, org.id)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: uuid.UUID,
    org: Organization = Depends(get_current_organization),
    db: AsyncSession = Depends(get_db),
    service: ProjectService = Depends(_service),
):
    await service.delete_project(project_id, org.id)
    await db.commit()
