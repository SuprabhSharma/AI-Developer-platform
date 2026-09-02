"""S3 StorageProvider stub. Implemented in Phase 8 when deploying to AWS; kept as
an interface now so switching from LocalStorage is a config change, not a rewrite."""
from app.integrations.storage.base import StorageProvider


class S3Storage(StorageProvider):
    def __init__(self, bucket: str, region: str):
        self.bucket = bucket
        self.region = region

    async def write(self, key: str, content: bytes) -> None:
        raise NotImplementedError("S3Storage is implemented in Phase 8")

    async def read(self, key: str) -> bytes:
        raise NotImplementedError("S3Storage is implemented in Phase 8")

    async def delete(self, key: str) -> None:
        raise NotImplementedError("S3Storage is implemented in Phase 8")

    async def exists(self, key: str) -> bool:
        raise NotImplementedError("S3Storage is implemented in Phase 8")
