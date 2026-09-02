import hashlib
import uuid
from fastapi import HTTPException, status
from app.core.config import settings
from app.integrations.storage.base import StorageProvider
from app.models.file import FileRecord, FileType
from app.repositories.file_repository import FileRepository
from app.services.file_path import get_parent_paths, normalise_path, validate_move_target


class FileService:
    def __init__(self, file_repo: FileRepository, storage: StorageProvider):
        self.file_repo = file_repo
        self.storage = storage

    async def list_tree(self, workspace_id: uuid.UUID) -> list[FileRecord]:
        return await self.file_repo.list_for_workspace(workspace_id)

    async def read_file(self, workspace_id: uuid.UUID, path: str) -> str:
        path = normalise_path(path)
        rec = await self.file_repo.get_by_path(workspace_id, path)
        if not rec or rec.file_type != FileType.FILE or not rec.storage_key:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
        return (await self.storage.read(rec.storage_key)).decode(errors="replace")

    async def _ensure_parents(self, workspace_id: uuid.UUID, path: str) -> None:
        for parent_path in get_parent_paths(path):
            existing = await self.file_repo.get_by_path(workspace_id, parent_path)
            if not existing:
                self.file_repo.db.add(FileRecord(workspace_id=workspace_id, path=parent_path, file_type=FileType.DIRECTORY, size_bytes=0))
                await self.file_repo.db.flush()
            elif existing.file_type != FileType.DIRECTORY:
                raise HTTPException(status.HTTP_409_CONFLICT, f"Path component '{parent_path}' is not a directory")

    async def write_file(self, workspace_id: uuid.UUID, path: str, content: str) -> FileRecord:
        return await self._write_file_bytes(workspace_id, path, content.encode())

    async def _write_file_bytes(self, workspace_id: uuid.UUID, path: str, content_bytes: bytes) -> FileRecord:
        path = normalise_path(path)
        existing = await self.file_repo.get_by_path(workspace_id, path)
        if existing and existing.file_type == FileType.DIRECTORY:
            raise HTTPException(status.HTTP_409_CONFLICT, "A folder already exists at this path")
        await self._ensure_parents(workspace_id, path)
        storage_key = f"workspaces/{workspace_id}/{path}"
        await self.storage.write(storage_key, content_bytes)
        rec = FileRecord(
            workspace_id=workspace_id, path=path, file_type=FileType.FILE,
            storage_key=storage_key, size_bytes=len(content_bytes),
            content_hash=hashlib.sha256(content_bytes).hexdigest(),
        )
        return await self.file_repo.upsert(rec)

    async def create_folder(self, workspace_id: uuid.UUID, path: str) -> FileRecord:
        path = normalise_path(path)
        if await self.file_repo.get_by_path(workspace_id, path):
            raise HTTPException(status.HTTP_409_CONFLICT, "A file or folder already exists at this path")
        await self._ensure_parents(workspace_id, path)
        rec = FileRecord(workspace_id=workspace_id, path=path, file_type=FileType.DIRECTORY, size_bytes=0)
        self.file_repo.db.add(rec)
        await self.file_repo.db.flush()
        return rec

    async def rename_path(self, workspace_id: uuid.UUID, path: str, new_path: str) -> FileRecord:
        path = normalise_path(path)
        new_path = normalise_path(new_path)
        if path == new_path:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot move an item onto itself")
        record = await self.file_repo.get_by_path(workspace_id, path)
        if not record:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File or folder not found")
        if record.file_type == FileType.DIRECTORY:
            validate_move_target(path, new_path)

        if await self.file_repo.get_by_path(workspace_id, new_path):
            raise HTTPException(status.HTTP_409_CONFLICT, "A file or folder already exists at the new path")

        await self._ensure_parents(workspace_id, new_path)

        if record.file_type == FileType.FILE:
            if not record.storage_key:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "File content not found")
            new_storage_key = f"workspaces/{workspace_id}/{new_path}"
            await self.storage.write(new_storage_key, await self.storage.read(record.storage_key))
            await self.storage.delete(record.storage_key)
            record.path, record.storage_key = new_path, new_storage_key
            await self.file_repo.db.flush()
            return record

        all_records = await self.file_repo.list_for_workspace(workspace_id)
        descendants = [r for r in all_records if r.path.startswith(f"{path}/")]
        for desc in descendants:
            target_desc_path = f"{new_path}{desc.path[len(path):]}"
            if await self.file_repo.get_by_path(workspace_id, target_desc_path):
                raise HTTPException(status.HTTP_409_CONFLICT, f"A file or folder already exists at: {target_desc_path}")

        for desc in descendants:
            target_desc_path = f"{new_path}{desc.path[len(path):]}"
            if desc.file_type == FileType.FILE and desc.storage_key:
                new_key = f"workspaces/{workspace_id}/{target_desc_path}"
                await self.storage.write(new_key, await self.storage.read(desc.storage_key))
                await self.storage.delete(desc.storage_key)
                desc.storage_key = new_key
            desc.path = target_desc_path

        record.path = new_path
        await self.file_repo.db.flush()
        return record

    rename_file = rename_path

    async def delete_path(self, workspace_id: uuid.UUID, path: str) -> None:
        path = normalise_path(path)
        record = await self.file_repo.get_by_path(workspace_id, path)
        if not record:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "File or folder not found")
        if record.file_type == FileType.FILE:
            if record.storage_key:
                await self.storage.delete(record.storage_key)
            await self.file_repo.delete(record)
        else:
            for desc in [r for r in await self.file_repo.list_for_workspace(workspace_id) if r.path.startswith(f"{path}/")]:
                if desc.storage_key:
                    await self.storage.delete(desc.storage_key)
                await self.file_repo.delete(desc)
            await self.file_repo.delete(record)

    delete_file = delete_path

    async def upload_files(
        self, workspace_id: uuid.UUID, uploads: list[tuple[str, bytes]], directories: list[str] | None = None,
    ) -> list[FileRecord]:
        if len(uploads) > settings.MAX_BATCH_UPLOAD_FILES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too many files in one upload")
        norm_files = [(normalise_path(p), c) for p, c in uploads]
        file_paths = {p for p, _ in norm_files}
        if len(file_paths) != len(norm_files):
            raise HTTPException(status.HTTP_409_CONFLICT, "Duplicate upload path")
        for p, c in norm_files:
            if len(c) > settings.MAX_FILE_UPLOAD_BYTES:
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File is too large: {p}")
        dir_paths = {normalise_path(p) for p in (directories or [])}
        if file_paths & dir_paths:
            raise HTTPException(status.HTTP_409_CONFLICT, "A path cannot be both a file and a folder")
        for p in file_paths | dir_paths:
            parts = p.split("/")
            if any("/".join(parts[:i]) in file_paths for i in range(1, len(parts))):
                raise HTTPException(status.HTTP_409_CONFLICT, f"A file is used as a folder: {p}")
        for p in file_paths:
            if (e := await self.file_repo.get_by_path(workspace_id, p)) and e.file_type == FileType.DIRECTORY:
                raise HTTPException(status.HTTP_409_CONFLICT, f"A folder already exists at: {p}")
        for p in dir_paths:
            if (e := await self.file_repo.get_by_path(workspace_id, p)) and e.file_type == FileType.FILE:
                raise HTTPException(status.HTTP_409_CONFLICT, f"A file already exists at: {p}")
        records: list[FileRecord] = []
        for p in sorted(dir_paths, key=lambda v: (v.count("/"), v)):
            existing = await self.file_repo.get_by_path(workspace_id, p)
            if existing:
                records.append(existing)
            else:
                await self._ensure_parents(workspace_id, p)
                rec = FileRecord(workspace_id=workspace_id, path=p, file_type=FileType.DIRECTORY, size_bytes=0)
                self.file_repo.db.add(rec)
                await self.file_repo.db.flush()
                records.append(rec)
        for p, content in norm_files:
            records.append(await self._write_file_bytes(workspace_id, p, content))
        return sorted(records, key=lambda r: r.path)
