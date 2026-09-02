import pytest


async def _auth_headers(client, email="agent-route@example.com"):
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_agent_plan_approve_execute_routes(client):
    headers = await _auth_headers(client)
    project = await client.post("/api/v1/projects", json={"name": "Agent route"}, headers=headers)
    project_id = project.json()["id"]

    planned = await client.post(f"/api/v1/projects/{project_id}/agent/plan", json={"task_description": "create a note"}, headers=headers)
    assert planned.status_code == 201
    plan = planned.json()
    step = plan["steps"][0]
    assert plan["status"] == "DRAFT"

    approved = await client.post(f"/api/v1/projects/{project_id}/agent/plan/{plan['id']}/steps/{step['id']}/approve", headers=headers)
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["approval_token"]

    executed = await client.post(f"/api/v1/projects/{project_id}/agent/plan/{plan['id']}/steps/{step['id']}/execute", headers=headers)
    assert executed.status_code == 200
    assert executed.json()["step"]["status"] == "EXECUTED"
    assert "executed" in executed.json()["logs"]
    stored = await client.get(f"/api/v1/projects/{project_id}/files/agent-notes.txt", headers=headers)
    assert stored.status_code == 200
    assert "Created by" in stored.json()["content"]
