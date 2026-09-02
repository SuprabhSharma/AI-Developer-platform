"""
Business logic for file tree browsing / reading / writing.
Bridges FileRecord (metadata, in Postgres) and StorageProvider (bytes, on disk/S3).
"""
import hashlib
import uuid
from pathlib import PurePosixPath

from fastapi import HTTPException, status

from app.core.config import settings
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
        path = self._normalise_path(path)
        record = await self.file_repo.get_by_path(workspace_id, path)
        if not record or record.file_type != FileType.FILE or not record.storage_key:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
        content = await self.storage.read(record.storage_key)
        return content.decode(errors="replace")

    async def write_file(self, workspace_id: uuid.UUID, path: str, content: str) -> FileRecord:
        return await self._write_file_bytes(workspace_id, path, content.encode())

    async def _write_file_bytes(self, workspace_id: uuid.UUID, path: str, content_bytes: bytes) -> FileRecord:
        path = self._normalise_path(path)
        existing = await self.file_repo.get_by_path(workspace_id, path)
        if existing and existing.file_type == FileType.DIRECTORY:
            raise HTTPException(status.HTTP_409_CONFLICT, "A folder already exists at this path")
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

    async def upload_files(
        self,
        workspace_id: uuid.UUID,
        uploads: list[tuple[str, bytes]],
        directories: list[str] | None = None,
    ) -> list[FileRecord]:
        """Validate and persist a batch while keeping every path workspace-relative."""
        directories = directories or []
        if len(uploads) > settings.MAX_BATCH_UPLOAD_FILES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too many files in one upload")

        normalised_files: list[tuple[str, bytes]] = []
        file_paths: set[str] = set()
        for path, content in uploads:
            normalised_path = self._normalise_path(path)
            if normalised_path in file_paths:
                raise HTTPException(status.HTTP_409_CONFLICT, f"Duplicate upload path: {normalised_path}")
            if len(content) > settings.MAX_FILE_UPLOAD_BYTES:
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File is too large: {normalised_path}")
            file_paths.add(normalised_path)
            normalised_files.append((normalised_path, content))

        directory_paths = {self._normalise_path(path) for path in directories}
        if file_paths & directory_paths:
            raise HTTPException(status.HTTP_409_CONFLICT, "A path cannot be both a file and a folder")

        # A file cannot also be an ancestor of another uploaded path.
        for path in file_paths | directory_paths:
            parts = path.split("/")
            if any("/".join(parts[:index]) in file_paths for index in range(1, len(parts))):
                raise HTTPException(status.HTTP_409_CONFLICT, f"A file is used as a folder: {path}")

        for path in file_paths:
            existing = await self.file_repo.get_by_path(workspace_id, path)
            if existing and existing.file_type == FileType.DIRECTORY:
                raise HTTPException(status.HTTP_409_CONFLICT, f"A folder already exists at this path: {path}")
        for path in directory_paths:
            existing = await self.file_repo.get_by_path(workspace_id, path)
            if existing and existing.file_type == FileType.FILE:
                raise HTTPException(status.HTTP_409_CONFLICT, f"A file already exists at this path: {path}")

        records: list[FileRecord] = []
        for path in sorted(directory_paths, key=lambda value: (value.count("/"), value)):
            existing = await self.file_repo.get_by_path(workspace_id, path)
            if existing:
                records.append(existing)
                continue
            record = FileRecord(workspace_id=workspace_id, path=path, file_type=FileType.DIRECTORY, size_bytes=0)
            self.file_repo.db.add(record)
            await self.file_repo.db.flush()
            records.append(record)

        for path, content in normalised_files:
            records.append(await self._write_file_bytes(workspace_id, path, content))

        return sorted(records, key=lambda record: record.path)

    async def create_folder(self, workspace_id: uuid.UUID, path: str) -> FileRecord:
        path = self._normalise_path(path)
        if await self.file_repo.get_by_path(workspace_id, path):
            raise HTTPException(status.HTTP_409_CONFLICT, "A file or folder already exists at this path")

        record = FileRecord(workspace_id=workspace_id, path=path, file_type=FileType.DIRECTORY, size_bytes=0)
        self.file_repo.db.add(record)
        await self.file_repo.db.flush()
        return record

    async def rename_file(self, workspace_id: uuid.UUID, path: str, new_path: str) -> FileRecord:
        path = self._normalise_path(path)
        new_path = self._normalise_path(new_path)
        record = await self.file_repo.get_by_path(workspace_id, path)
        if not record or record.file_type != FileType.FILE or not record.storage_key:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
        if await self.file_repo.get_by_path(workspace_id, new_path):
            raise HTTPException(status.HTTP_409_CONFLICT, "A file or folder already exists at the new path")

        content = await self.storage.read(record.storage_key)
        new_storage_key = f"workspaces/{workspace_id}/{new_path}"
        await self.storage.write(new_storage_key, content)
        await self.storage.delete(record.storage_key)
        record.path = new_path
        record.storage_key = new_storage_key
        await self.file_repo.db.flush()
        return record

    async def delete_file(self, workspace_id: uuid.UUID, path: str) -> None:
        path = self._normalise_path(path)
        record = await self.file_repo.get_by_path(workspace_id, path)
        if not record or record.file_type != FileType.FILE:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
        if record.storage_key:
            await self.storage.delete(record.storage_key)
        await self.file_repo.delete(record)

    @staticmethod
    def _normalise_path(path: str) -> str:
        candidate = path.strip().replace("\\", "/")
        parts = candidate.split("/")
        if (
            not candidate
            or len(candidate) > 2048
            or candidate.startswith("/")
            or "\x00" in candidate
            or any(part in {"", ".", ".."} for part in parts)
            or PurePosixPath(candidate).is_absolute()
        ):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Path must stay inside the project workspace")
        return "/".join(parts)
