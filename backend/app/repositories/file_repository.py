"""Data-access layer for FileRecord (file-tree metadata)."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import FileRecord


class FileRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_for_workspace(self, workspace_id: uuid.UUID) -> list[FileRecord]:
        result = await self.db.execute(
            select(FileRecord).where(FileRecord.workspace_id == workspace_id).order_by(FileRecord.path)
        )
        return list(result.scalars().all())

    async def get_by_path(self, workspace_id: uuid.UUID, path: str) -> FileRecord | None:
        result = await self.db.execute(
            select(FileRecord).where(FileRecord.workspace_id == workspace_id, FileRecord.path == path)
        )
        return result.scalar_one_or_none()

    async def upsert(self, record: FileRecord) -> FileRecord:
        existing = await self.get_by_path(record.workspace_id, record.path)
        if existing:
            existing.storage_key = record.storage_key
            existing.size_bytes = record.size_bytes
            existing.content_hash = record.content_hash
            await self.db.flush()
            return existing
        self.db.add(record)
        await self.db.flush()
        return record
