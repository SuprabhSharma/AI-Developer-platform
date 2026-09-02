import pytest


async def _auth_headers(client, email="proj@example.com"):
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_and_list_project(client):
    headers = await _auth_headers(client)
    create_resp = await client.post("/api/v1/projects", json={"name": "My Project"}, headers=headers)
    assert create_resp.status_code == 201
    project = create_resp.json()
    assert project["name"] == "My Project"

    list_resp = await client.get("/api/v1/projects", headers=headers)
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_get_missing_project_404(client):
    headers = await _auth_headers(client, "proj2@example.com")
    resp = await client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_project_requires_auth(client):
    resp = await client.get("/api/v1/projects")
    assert resp.status_code == 401
