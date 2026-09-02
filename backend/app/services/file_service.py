"""
Business logic for file tree browsing / reading / writing.
Bridges FileRecord (metadata, in Postgres) and StorageProvider (bytes, on disk/S3).
"""
import hashlib
import uuid

from fastapi import HTTPException, status

from app.integrations.storage.base import StorageProvider
from app.models.file import FileRecord, FileType
from app.repositories.file_repository import FileRepository


class FileService:
    def __init__(self, file_repo: FileRepository, storage: StorageProvider):
        self.file_repo = file_repo
        self.storage = storage

    async def list_tree(self, workspace_id: uuid.UUID) -> list[FileRecord]:
        return await self.file_repo.list_for_workspace(workspace_id)

    async def read_file(self, workspace_id: uuid.UUID, path: str) -> str:
        record = await self.file_repo.get_by_path(workspace_id, path)
        if not record or record.file_type != FileType.FILE or not record.storage_key:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
        content = await self.storage.read(record.storage_key)
        return content.decode(errors="replace")

    async def write_file(self, workspace_id: uuid.UUID, path: str, content: str) -> FileRecord:
        content_bytes = content.encode()
        storage_key = f"workspaces/{workspace_id}/{path}"
        await self.storage.write(storage_key, content_bytes)

        record = FileRecord(
            workspace_id=workspace_id,
            path=path,
            file_type=FileType.FILE,
            storage_key=storage_key,
            size_bytes=len(content_bytes),
            content_hash=hashlib.sha256(content_bytes).hexdigest(),
        )
        return await self.file_repo.upsert(record)
