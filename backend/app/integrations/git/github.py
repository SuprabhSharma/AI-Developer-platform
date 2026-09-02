"""
GitHubProvider — OAuth + repo listing. Clone/commit/branch/PR operations are
Phase 7 work; this Phase 1 stub establishes the interface and the OAuth
handshake shape so the rest of the app can be wired against it early.
"""
import httpx

from app.core.config import settings
from app.integrations.git.base import GitProvider

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_URL = "https://api.github.com"


class GitHubProvider(GitProvider):
    async def get_authorize_url(self, state: str) -> str:
        return (
            f"{GITHUB_AUTHORIZE_URL}?client_id={settings.GITHUB_CLIENT_ID}"
            f"&scope=repo&state={state}"
        )

    async def exchange_code_for_token(self, code: str) -> str:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                GITHUB_TOKEN_URL,
                headers={"Accept": "application/json"},
                data={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "code": code,
                },
            )
            resp.raise_for_status()
            return resp.json()["access_token"]

    async def list_repositories(self, access_token: str) -> list[dict]:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GITHUB_API_URL}/user/repos",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()
