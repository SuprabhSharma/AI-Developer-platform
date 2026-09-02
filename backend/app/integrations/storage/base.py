"""StorageProvider interface — file bytes never touch hard-coded paths outside this module's implementations."""
from abc import ABC, abstractmethod


class StorageProvider(ABC):
    @abstractmethod
    async def write(self, key: str, content: bytes) -> None: ...

    @abstractmethod
    async def read(self, key: str) -> bytes: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    @abstractmethod
    async def exists(self, key: str) -> bool: ...
