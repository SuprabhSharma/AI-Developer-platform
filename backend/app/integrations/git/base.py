"""GitProvider interface — so GitHub today, GitLab/Bitbucket later, without touching callers."""
from abc import ABC, abstractmethod


class GitProvider(ABC):
    @abstractmethod
    async def get_authorize_url(self, state: str) -> str: ...

    @abstractmethod
    async def exchange_code_for_token(self, code: str) -> str: ...

    @abstractmethod
    async def list_repositories(self, access_token: str) -> list[dict]: ...
