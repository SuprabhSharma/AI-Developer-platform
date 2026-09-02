import pytest


async def _auth_headers(client, email="move_test@example.com"):
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_file_rename_and_move_file(client):
    headers = await _auth_headers(client, "move1@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Move 1"}, headers=headers)
    project_id = project_resp.json()["id"]
    prefix = f"/api/v1/projects/{project_id}/files"

    create_resp = await client.put(f"{prefix}/src/test.py", json={"content": "original content"}, headers=headers)
    assert create_resp.status_code == 200

    rename_resp = await client.patch(f"{prefix}/src/test.py", json={"new_path": "src/test_old.py"}, headers=headers)
    assert rename_resp.status_code == 200
    assert rename_resp.json()["path"] == "src/test_old.py"

    old_read = await client.get(f"{prefix}/src/test.py", headers=headers)
    assert old_read.status_code == 404
    new_read = await client.get(f"{prefix}/src/test_old.py", headers=headers)
    assert new_read.status_code == 200
    assert new_read.json()["content"] == "original content"

    move_resp = await client.patch(f"{prefix}/src/test_old.py", json={"new_path": "archive/test.py"}, headers=headers)
    assert move_resp.status_code == 200
    assert move_resp.json()["path"] == "archive/test.py"

    archived_read = await client.get(f"{prefix}/archive/test.py", headers=headers)
    assert archived_read.status_code == 200
    assert archived_read.json()["content"] == "original content"


@pytest.mark.asyncio
async def test_move_folder_recursively(client):
    headers = await _auth_headers(client, "move2@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Move 2"}, headers=headers)
    project_id = project_resp.json()["id"]
    prefix = f"/api/v1/projects/{project_id}/files"

    await client.post(f"{prefix}/folder", json={"path": "src/components"}, headers=headers)
    await client.put(f"{prefix}/src/components/Button.tsx", json={"content": "btn"}, headers=headers)
    await client.put(f"{prefix}/src/components/sub/Inner.tsx", json={"content": "inner"}, headers=headers)

    move_folder_resp = await client.patch(f"{prefix}/src/components", json={"new_path": "archive/components"}, headers=headers)
    assert move_folder_resp.status_code == 200
    assert move_folder_resp.json()["path"] == "archive/components"

    btn_read = await client.get(f"{prefix}/archive/components/Button.tsx", headers=headers)
    assert btn_read.status_code == 200
    assert btn_read.json()["content"] == "btn"

    inner_read = await client.get(f"{prefix}/archive/components/sub/Inner.tsx", headers=headers)
    assert inner_read.status_code == 200
    assert inner_read.json()["content"] == "inner"

    old_btn = await client.get(f"{prefix}/src/components/Button.tsx", headers=headers)
    assert old_btn.status_code == 404


@pytest.mark.asyncio
async def test_prevent_invalid_move_operations(client):
    headers = await _auth_headers(client, "move3@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Move 3"}, headers=headers)
    project_id = project_resp.json()["id"]
    prefix = f"/api/v1/projects/{project_id}/files"

    await client.post(f"{prefix}/folder", json={"path": "src"}, headers=headers)
    await client.put(f"{prefix}/src/file1.py", json={"content": "file 1"}, headers=headers)
    await client.put(f"{prefix}/src/file2.py", json={"content": "file 2"}, headers=headers)

    conflict_resp = await client.patch(f"{prefix}/src/file1.py", json={"new_path": "src/file2.py"}, headers=headers)
    assert conflict_resp.status_code == 409

    descendant_resp = await client.patch(f"{prefix}/src", json={"new_path": "src/sub/nested"}, headers=headers)
    assert descendant_resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_folder_recursively(client):
    headers = await _auth_headers(client, "move4@example.com")
    project_resp = await client.post("/api/v1/projects", json={"name": "Move 4"}, headers=headers)
    project_id = project_resp.json()["id"]
    prefix = f"/api/v1/projects/{project_id}/files"

    await client.post(f"{prefix}/folder", json={"path": "tests"}, headers=headers)
    await client.put(f"{prefix}/tests/test_a.py", json={"content": "pass"}, headers=headers)
    await client.put(f"{prefix}/tests/sub/test_b.py", json={"content": "pass"}, headers=headers)

    del_resp = await client.delete(f"{prefix}/tests", headers=headers)
    assert del_resp.status_code == 204

    assert (await client.get(f"{prefix}/tests/test_a.py", headers=headers)).status_code == 404
    assert (await client.get(f"{prefix}/tests/sub/test_b.py", headers=headers)).status_code == 404

    tree_resp = await client.get(prefix, headers=headers)
    items = [item["path"] for item in tree_resp.json()["items"]]
    assert not any(p.startswith("tests") for p in items)
