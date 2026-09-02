import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.agent import PlanStatus, PlanStepStatus


class PlanStepRead(BaseModel):
    id: uuid.UUID
    plan_id: uuid.UUID
    order: int
    tool_name: str
    tool_input: dict
    description: str
    status: PlanStepStatus
    diff_before: str | None
    diff_after: str | None
    approval_token: str | None

    model_config = {"from_attributes": True}


class AgentRunRead(BaseModel):
    id: uuid.UUID
    plan_id: uuid.UUID
    current_step_order: int
    status: PlanStatus
    logs: str
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class AgentPlanRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    task_description: str
    status: PlanStatus
    created_at: datetime
    steps: list[PlanStepRead]
    run: AgentRunRead | None


class AgentPlanRequest(BaseModel):
    task_description: str = Field(min_length=1, max_length=20_000)


class AgentExecuteResponse(BaseModel):
    step: PlanStepRead
    logs: str
    result: object | None = None


class AgentContinueRequest(BaseModel):
    context: str = Field(default="", max_length=100_000)


class AgentDirectRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
    active_file: str | None = None
    file_content: str | None = None
    workspace_files: list[str] = Field(default_factory=list)
    instruction_mode: str = "edit"

