"""Data-access layer for Job."""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job


class JobRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, job: Job) -> Job:
        self.db.add(job)
        await self.db.flush()
        return job

    async def get_by_id(self, job_id: uuid.UUID) -> Job | None:
        return await self.db.get(Job, job_id)
