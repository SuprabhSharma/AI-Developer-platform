import uuid

import pytest

from app.agents.tools.write import EditFileTool, WriteFileTool
from app.ai.providers.mock import MockProvider
from app.models.agent import PlanStatus, PlanStepStatus
from app.models.project import Project, Workspace
from app.services.agent_service import AgentService
from app.services.agent_helpers import parse_plan


def test_empty_ai_plan_falls_back_to_safe_workspace_search():
    steps = parse_plan("[]", "find the login flow")
    assert steps == [{
        "tool_name": "search_files",
        "tool_input": {"query": "find the login flow"},
        "description": "Search the workspace for context related to the task",
    }]


def test_empty_ai_plan_without_context_still_returns_a_safe_step():
    steps = parse_plan(None)
    assert len(steps) == 1
    assert steps[0]["tool_name"] == "search_files"
    assert steps[0]["tool_input"]["query"]


def test_wrapped_and_fenced_ai_plan_is_parsed():
    steps = parse_plan('```json\n{"steps":[{"tool_name":"read_file","tool_input":{"path":"README.md"},"description":"Read project context"}]}\n```')
    assert steps[0]["tool_name"] == "read_file"
    assert steps[0]["tool_input"] == {"path": "README.md"}


@pytest.mark.asyncio
async def test_write_tools_reject_missing_and_invalid_approval_tokens(tmp_path):
    validator = lambda token: token == "pending-token"
    tool = WriteFileTool(tmp_path, validator)
    missing = await tool.execute(path="a.txt", content="nope")
    invalid = await tool.execute(path="a.txt", content="nope", approval_token="wrong")
    assert not missing.success and missing.error == "Approval required"
    assert not invalid.success and invalid.error == "Approval required"
    assert not (tmp_path / "a.txt").exists()
    valid = await tool.execute(path="a.txt", content="yes", approval_token="pending-token")
    assert valid.success

    edit = EditFileTool(tmp_path, validator)
    invalid_edit = await edit.execute(path="a.txt", new_content="no", approval_token="wrong")
    assert not invalid_edit.success and invalid_edit.error == "Approval required"


@pytest.mark.asyncio
async def test_agent_create_approve_execute_happy_path(db_session, tmp_path):
    user_id = uuid.uuid4()
    project = Project(organization_id=uuid.uuid4(), owner_id=user_id, name="Agent", slug="agent")
    db_session.add(project)
    await db_session.flush()
    db_session.add(Workspace(project_id=project.id, name="main"))
    await db_session.flush()

    service = AgentService(db_session, MockProvider(), tmp_path)
    plan = await service.create_plan(project.id, user_id, "create an agent note")
    assert plan.status == PlanStatus.DRAFT
    assert len(plan.steps) == 1

    step = await service.approve_step(plan.steps[0].id)
    assert step.status == PlanStepStatus.APPROVED
    assert step.approval_token
    assert step.diff_before == ""
    assert "Created by" in step.diff_after

    step = await service.execute_step(step.id)
    await db_session.commit()
    assert step.status == PlanStepStatus.EXECUTED
    assert (tmp_path / "agent-notes.txt").read_text() == "Created by the mock coding agent.\n"
    current = await service.get_plan(plan.id)
    assert current.status == PlanStatus.COMPLETED
    assert "executed" in current.runs[0].logs
