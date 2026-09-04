"""Data-access layer for Project/Workspace."""
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project, Workspace


class ProjectRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, project: Project) -> Project:
        self.db.add(project)
        await self.db.flush()
        return project

    async def get_by_id(self, project_id: uuid.UUID) -> Project | None:
        result = await self.db.execute(
            select(Project).where(Project.id == project_id).options(selectinload(Project.workspaces))
        )
        return result.scalar_one_or_none()

    async def get_by_id_and_owner(self, project_id: uuid.UUID | str, user_id: uuid.UUID | str) -> Project | None:
        pid = uuid.UUID(str(project_id))
        uid = uuid.UUID(str(user_id))
        result = await self.db.execute(
            select(Project)
            .where(Project.id == pid, Project.owner_id == uid)
            .options(selectinload(Project.workspaces))
        )
        return result.scalar_one_or_none()

    async def list_for_organization(
        self, organization_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[Project], int]:
        count_result = await self.db.execute(
            select(func.count()).select_from(Project).where(Project.organization_id == organization_id)
        )
        total = count_result.scalar_one()

        result = await self.db.execute(
            select(Project)
            .where(Project.organization_id == organization_id)
            .order_by(Project.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(result.scalars().all()), total

    async def delete(self, project: Project) -> None:
        await self.db.delete(project)
        await self.db.flush()

    async def create_workspace(self, workspace: Workspace) -> Workspace:
        self.db.add(workspace)
        await self.db.flush()
        return workspace
