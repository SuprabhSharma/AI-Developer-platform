import pytest


async def _auth_headers(client, email="explorer_test@example.com"):
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_nested_folder_creation(client):
    """Test 1: Create a/b/c -> verify a, a/b, a/b/c exist."""
    headers = await _auth_headers(client, "test1@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 1"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    res = await client.post(f"{prefix}/folders", json={"path": "a/b/c"}, headers=headers)
    assert res.status_code == 201

    tree = (await client.get(prefix, headers=headers)).json()["items"]
    paths = {item["path"] for item in tree}
    assert "a" in paths
    assert "a/b" in paths
    assert "a/b/c" in paths


@pytest.mark.asyncio
async def test_file_parent_auto_creation(client):
    """Test 2: Write a/b/c.py -> verify a, a/b, a/b/c.py exist."""
    headers = await _auth_headers(client, "test2@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 2"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    res = await client.put(f"{prefix}/a/b/c.py", json={"content": "print('hello')"}, headers=headers)
    assert res.status_code == 200

    tree = (await client.get(prefix, headers=headers)).json()["items"]
    paths = {item["path"]: item["file_type"] for item in tree}
    assert paths.get("a") == "DIRECTORY"
    assert paths.get("a/b") == "DIRECTORY"
    assert paths.get("a/b/c.py") == "FILE"


@pytest.mark.asyncio
async def test_folder_delete_cascade(client):
    """Test 3: Create src with a.py and utils/helper.py. Delete src -> verify all removed."""
    headers = await _auth_headers(client, "test3@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 3"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    await client.put(f"{prefix}/src/a.py", json={"content": "a"}, headers=headers)
    await client.put(f"{prefix}/src/utils/helper.py", json={"content": "helper"}, headers=headers)

    del_res = await client.delete(f"{prefix}/src", headers=headers)
    assert del_res.status_code == 204

    tree = (await client.get(prefix, headers=headers)).json()["items"]
    assert len(tree) == 0
    assert (await client.get(f"{prefix}/src/a.py", headers=headers)).status_code == 404
    assert (await client.get(f"{prefix}/src/utils/helper.py", headers=headers)).status_code == 404


@pytest.mark.asyncio
async def test_folder_rename(client):
    """Test 4: Rename src to source -> verify descendants become source/a.py, source/utils/helper.py."""
    headers = await _auth_headers(client, "test4@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 4"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    await client.put(f"{prefix}/src/a.py", json={"content": "content a"}, headers=headers)
    await client.put(f"{prefix}/src/utils/helper.py", json={"content": "content helper"}, headers=headers)

    rename_res = await client.patch(f"{prefix}/src", json={"new_path": "source"}, headers=headers)
    assert rename_res.status_code == 200

    tree = (await client.get(prefix, headers=headers)).json()["items"]
    paths = {item["path"] for item in tree}
    assert "source" in paths
    assert "source/a.py" in paths
    assert "source/utils" in paths
    assert "source/utils/helper.py" in paths
    assert not any(p.startswith("src") for p in paths)

    # Verify content readable at new paths
    res_a = await client.get(f"{prefix}/source/a.py", headers=headers)
    assert res_a.status_code == 200
    assert res_a.json()["content"] == "content a"


@pytest.mark.asyncio
async def test_file_move(client):
    """Test 5: Move src/a.py to tests/a.py -> verify path changes."""
    headers = await _auth_headers(client, "test5@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 5"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    await client.put(f"{prefix}/src/a.py", json={"content": "move me"}, headers=headers)

    move_res = await client.patch(f"{prefix}/src/a.py", json={"new_path": "tests/a.py"}, headers=headers)
    assert move_res.status_code == 200

    assert (await client.get(f"{prefix}/src/a.py", headers=headers)).status_code == 404
    new_get = await client.get(f"{prefix}/tests/a.py", headers=headers)
    assert new_get.status_code == 200
    assert new_get.json()["content"] == "move me"


@pytest.mark.asyncio
async def test_folder_move(client):
    """Test 6: Move src/components to archive/components -> verify every descendant path."""
    headers = await _auth_headers(client, "test6@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 6"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    await client.put(f"{prefix}/src/components/Button.tsx", json={"content": "Button"}, headers=headers)
    await client.put(f"{prefix}/src/components/forms/Login.tsx", json={"content": "Login"}, headers=headers)

    move_res = await client.patch(f"{prefix}/src/components", json={"new_path": "archive/components"}, headers=headers)
    assert move_res.status_code == 200

    tree = (await client.get(prefix, headers=headers)).json()["items"]
    paths = {item["path"] for item in tree}
    assert "archive/components/Button.tsx" in paths
    assert "archive/components/forms/Login.tsx" in paths
    assert "src/components/Button.tsx" not in paths


@pytest.mark.asyncio
async def test_invalid_move_operation(client):
    """Test 7: Verify src cannot be moved into src/components."""
    headers = await _auth_headers(client, "test7@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 7"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    await client.put(f"{prefix}/src/components/Button.tsx", json={"content": "Btn"}, headers=headers)

    invalid_res = await client.patch(f"{prefix}/src", json={"new_path": "src/components"}, headers=headers)
    assert invalid_res.status_code == 400


@pytest.mark.asyncio
async def test_duplicate_path_operations(client):
    """Test 8: Verify creation/rename/move fails if destination already exists."""
    headers = await _auth_headers(client, "test8@example.com")
    proj = (await client.post("/api/v1/projects", json={"name": "Test 8"}, headers=headers)).json()
    prefix = f"/api/v1/projects/{proj['id']}/files"

    await client.post(f"{prefix}/folders", json={"path": "src/components"}, headers=headers)
    # Duplicate folder creation
    dup_folder = await client.post(f"{prefix}/folders", json={"path": "src/components"}, headers=headers)
    assert dup_folder.status_code == 409

    await client.put(f"{prefix}/src/file1.py", json={"content": "1"}, headers=headers)
    await client.put(f"{prefix}/src/file2.py", json={"content": "2"}, headers=headers)

    # Rename onto existing file
    dup_rename = await client.patch(f"{prefix}/src/file1.py", json={"new_path": "src/file2.py"}, headers=headers)
    assert dup_rename.status_code == 409
