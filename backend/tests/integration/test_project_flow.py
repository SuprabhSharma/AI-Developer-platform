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


@pytest.mark.asyncio
async def test_file_lifecycle_and_empty_folder(client):
    headers = await _auth_headers(client, "files@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Files"}, headers=headers)
    project_id = project_resp.json()["id"]
    prefix = f"/api/v1/projects/{project_id}/files"

    folder_resp = await client.post(f"{prefix}/folder", json={"path": "src"}, headers=headers)
    assert folder_resp.status_code == 201
    assert folder_resp.json()["file_type"] == "DIRECTORY"

    create_resp = await client.put(f"{prefix}/src/main.py", json={"content": "print('hi')"}, headers=headers)
    assert create_resp.status_code == 200
    assert create_resp.json()["content"] == "print('hi')"

    rename_resp = await client.patch(f"{prefix}/src/main.py", json={"new_path": "src/app.py"}, headers=headers)
    assert rename_resp.status_code == 200
    assert rename_resp.json()["path"] == "src/app.py"

    delete_resp = await client.delete(f"{prefix}/src/app.py", headers=headers)
    assert delete_resp.status_code == 204

    tree_resp = await client.get(prefix, headers=headers)
    assert [item["path"] for item in tree_resp.json()["items"]] == ["src"]


@pytest.mark.asyncio
async def test_file_paths_cannot_escape_workspace(client):
    headers = await _auth_headers(client, "paths@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Paths"}, headers=headers)
    project_id = project_resp.json()["id"]
    resp = await client.put(
        f"/api/v1/projects/{project_id}/files/../secret.txt",
        json={"content": "nope"},
        headers=headers,
    )
    assert resp.status_code in (400, 404)


@pytest.mark.asyncio
async def test_batch_upload_preserves_relative_paths(client):
    headers = await _auth_headers(client, "batch-files@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Batch files"}, headers=headers)
    project_id = project_resp.json()["id"]
    prefix = f"/api/v1/projects/{project_id}/files"
    response = await client.post(
        f"{prefix}/upload",
        data={"paths": ["src/main.py", "README.md"]},
        files=[
            ("files", ("main.py", b"print('hi')", "text/plain")),
            ("files", ("README.md", b"# Files", "text/markdown")),
        ],
        headers=headers,
    )
    assert response.status_code == 201
    assert {item["path"] for item in response.json()["items"]} == {"README.md", "src/main.py"}

    read_resp = await client.get(f"{prefix}/src/main.py", headers=headers)
    assert read_resp.status_code == 200
    assert read_resp.json()["content"] == "print('hi')"
