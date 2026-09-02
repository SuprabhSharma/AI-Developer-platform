"""Local-disk StorageProvider, used in development."""
from pathlib import Path

from app.core.config import settings
from app.integrations.storage.base import StorageProvider


class LocalStorage(StorageProvider):
    def __init__(self, root: str | None = None):
        self.root = Path(root or settings.LOCAL_STORAGE_ROOT).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError("Storage key escapes storage root")
        return path

    async def write(self, key: str, content: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    async def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    async def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    async def exists(self, key: str) -> bool:
        return self._path(key).exists()
