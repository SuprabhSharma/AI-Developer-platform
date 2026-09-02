"""Business logic for project creation/listing/deletion and ownership checks."""
import re
import uuid

from fastapi import HTTPException, status

from app.models.project import Project, Workspace
from app.repositories.project_repository import ProjectRepository
from app.schemas.project import ProjectCreate


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or uuid.uuid4().hex[:8]


class ProjectService:
    def __init__(self, project_repo: ProjectRepository):
        self.project_repo = project_repo

    async def create_project(self, organization_id: uuid.UUID, owner_id: uuid.UUID, payload: ProjectCreate) -> Project:
        project = await self.project_repo.create(
            Project(
                organization_id=organization_id,
                owner_id=owner_id,
                name=payload.name,
                slug=f"{slugify(payload.name)}-{uuid.uuid4().hex[:6]}",
                description=payload.description,
            )
        )
        # Every project starts with one default workspace (Phase 2 builds on this).
        await self.project_repo.create_workspace(Workspace(project_id=project.id, name="main"))
        return project

    async def list_projects(self, organization_id: uuid.UUID, page: int, page_size: int):
        return await self.project_repo.list_for_organization(organization_id, page, page_size)

    async def get_project_or_404(self, project_id: uuid.UUID, organization_id: uuid.UUID) -> Project:
        project = await self.project_repo.get_by_id(project_id)
        if not project or project.organization_id != organization_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
        return project

    async def delete_project(self, project_id: uuid.UUID, organization_id: uuid.UUID) -> None:
        project = await self.get_project_or_404(project_id, organization_id)
        await self.project_repo.delete(project)
