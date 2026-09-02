from app.core.config import settings
from app.integrations.storage.base import StorageProvider
from app.integrations.storage.local import LocalStorage
from app.integrations.storage.s3 import S3Storage


def get_storage_provider() -> StorageProvider:
    if settings.STORAGE_PROVIDER == "s3":
        return S3Storage(settings.S3_BUCKET, settings.S3_REGION)
    return LocalStorage()
