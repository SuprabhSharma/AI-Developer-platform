import pytest


@pytest.mark.asyncio
async def test_register_login_refresh(client):
    register_resp = await client.post(
        "/api/v1/auth/register", json={"email": "dev@example.com", "password": "password123"}
    )
    assert register_resp.status_code == 201
    tokens = register_resp.json()
    assert "access_token" in tokens

    login_resp = await client.post("/api/v1/auth/login", json={"email": "dev@example.com", "password": "password123"})
    assert login_resp.status_code == 200

    refresh_resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh_resp.status_code == 200


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    await client.post("/api/v1/auth/register", json={"email": "dev2@example.com", "password": "password123"})
    resp = await client.post("/api/v1/auth/login", json={"email": "dev2@example.com", "password": "wrong"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_duplicate_registration_conflicts(client):
    payload = {"email": "dup@example.com", "password": "password123"}
    first = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409
