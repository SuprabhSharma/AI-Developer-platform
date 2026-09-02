import pytest

from app.core.redis import get_redis
from app.main import app


class AllowRedis:
    async def eval(self, *args):
        return 1


class DenyRedis:
    async def eval(self, *args):
        return 0


async def _auth_headers(client, email="ai@example.com"):
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_stream_chat_persists_usage_and_conversation(client):
    app.dependency_overrides[get_redis] = lambda: AllowRedis()
    headers = await _auth_headers(client)
    project = await client.post("/api/v1/projects", json={"name": "AI project"}, headers=headers)
    project_id = project.json()["id"]

    response = await client.get(
        f"/api/v1/projects/{project_id}/chat/stream",
        params={"message": "hello streaming"},
        headers=headers,
    )
    assert response.status_code == 200
    assert "event: token" in response.text
    assert "event: done" in response.text
    assert "hello" in response.text and "streaming" in response.text

    usage = await client.get("/api/v1/usage", headers=headers)
    assert usage.status_code == 200
    assert usage.json()["total_requests"] == 1
    assert usage.json()["tokens_used_this_week"] > 0
    assert usage.json()["providers"][0]["provider"] == "mock"


@pytest.mark.asyncio
async def test_file_ai_action_uses_stream_endpoint(client):
    app.dependency_overrides[get_redis] = lambda: AllowRedis()
    headers = await _auth_headers(client, "actions@example.com")
    project = await client.post("/api/v1/projects", json={"name": "Actions"}, headers=headers)
    project_id = project.json()["id"]

    response = await client.post(
        f"/api/v1/projects/{project_id}/chat/stream",
        json={"action": "explain_code", "path": "main.py", "code": "print('hi')"},
        headers=headers,
    )
    assert response.status_code == 200
    assert "Explain this code" in response.text


@pytest.mark.asyncio
async def test_ai_rate_limit_returns_429(client):
    app.dependency_overrides[get_redis] = lambda: DenyRedis()
    headers = await _auth_headers(client, "limited@example.com")
    project = await client.post("/api/v1/projects", json={"name": "Limited"}, headers=headers)
    response = await client.get(
        f"/api/v1/projects/{project.json()['id']}/chat/stream",
        params={"message": "blocked"},
        headers=headers,
    )
    assert response.status_code == 429
    assert "rate limit exceeded" in response.json()["error"]
