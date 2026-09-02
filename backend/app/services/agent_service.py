"""Plan, approve, and execute the Phase 5 coding-agent workflow."""
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.registry import ToolRegistry
from app.agents.tools.read_only import ReadFileTool
from app.ai.factory import get_ai_provider
from app.ai.provider import AIProvider, ChatMessage
from app.core.config import settings
from app.integrations.storage.factory import get_storage_provider
from app.models.agent import AgentRun, Plan, PlanStatus, PlanStep, PlanStepStatus
from app.models.project import Project
from app.repositories.file_repository import FileRepository
from app.services.file_service import FileService
from app.services.agent_helpers import parse_plan, preview_step

WRITE_TOOLS = {"write_file", "edit_file"}
PLANNING_PROMPT = """You are a coding agent planner. Return only a non-empty JSON array of 1-3 steps. Each step has tool_name (read_file, search_files, write_file, or edit_file), tool_input (object), and description. If unsure, use search_files first. No markdown or commentary."""
CONTINUATION_PROMPT = """You are continuing a coding task after a tool result. Return only a non-empty JSON array of the next 1-3 steps. Use read_file or search_files to inspect more context, then write_file or edit_file when a code change is justified. Never claim a change was made; return the tool steps needed to make it. Each step has tool_name, tool_input, and description. No markdown or commentary."""


class AgentService:
    def __init__(self, db: AsyncSession, provider: AIProvider | None = None, workspace_root: Path | None = None):
        self.db = db
        self.provider = provider or get_ai_provider()
        self.workspace_root = workspace_root
        self.last_result = None

    async def create_plan(self, project_id: uuid.UUID, user_id: uuid.UUID, task_description: str) -> Plan:
        response = await self.provider.chat([ChatMessage("system", PLANNING_PROMPT), ChatMessage("user", task_description)])
        # Some providers can return an empty/null content field when a model
        # declines the JSON format. The parser turns that into a safe search
        # step so the agent remains usable instead of returning a 422 error.
        items = parse_plan(response.content or "", task_description)
        plan = Plan(project_id=project_id, user_id=user_id, task_description=task_description)
        self.db.add(plan)
        await self.db.flush()
        for order, item in enumerate(items, 1):
            self.db.add(PlanStep(plan_id=plan.id, order=order, tool_name=item["tool_name"], tool_input=item["tool_input"], description=item["description"]))
        self.db.add(AgentRun(plan_id=plan.id, status=PlanStatus.DRAFT, current_step_order=0, logs=""))
        await self.db.flush()
        return await self.get_plan(plan.id)

    async def continue_plan(self, plan_id: uuid.UUID, context: str) -> Plan:
        plan = await self.get_plan(plan_id)
        response = await self.provider.chat([
            ChatMessage("system", CONTINUATION_PROMPT),
            ChatMessage("user", f"Original task:\n{plan.task_description}\n\nTool result:\n{context}"),
        ])
        items = parse_plan(response.content or "", plan.task_description)
        next_order = max((step.order for step in plan.steps), default=0) + 1
        for offset, item in enumerate(items, next_order):
            self.db.add(PlanStep(plan_id=plan.id, order=offset, tool_name=item["tool_name"], tool_input=item["tool_input"], description=item["description"]))
        plan.status = PlanStatus.DRAFT
        self._run(plan).status = PlanStatus.DRAFT
        await self.db.flush()
        return await self.get_plan(plan.id)

    async def get_plan(self, plan_id: uuid.UUID) -> Plan:
        result = await self.db.execute(
            select(Plan).where(Plan.id == plan_id).options(
                selectinload(Plan.steps), selectinload(Plan.runs),
                selectinload(Plan.project).selectinload(Project.workspaces),
            )
        )
        plan = result.scalar_one_or_none()
        if not plan:
            raise ValueError("Plan not found")
        return plan

    async def get_step(self, step_id: uuid.UUID) -> PlanStep:
        result = await self.db.execute(
            select(PlanStep).where(PlanStep.id == step_id).options(
                selectinload(PlanStep.plan).selectinload(Plan.steps),
                selectinload(PlanStep.plan).selectinload(Plan.runs),
                selectinload(PlanStep.plan).selectinload(Plan.project).selectinload(Project.workspaces),
            )
        )
        step = result.scalar_one_or_none()
        if not step:
            raise ValueError("Step not found")
        return step

    async def approve_step(self, step_id: uuid.UUID) -> PlanStep:
        step = await self.get_step(step_id)
        if step.status != PlanStepStatus.PENDING:
            raise ValueError("Step cannot be approved")
        if step.tool_name in WRITE_TOOLS:
            before = await ReadFileTool(self._root(step)).execute(path=step.tool_input.get("path", ""))
            step.diff_before = before.data if before.success else ""
            step.diff_after = preview_step(step, step.diff_before)
        step.approval_token = str(uuid.uuid4())
        step.status = PlanStepStatus.APPROVED
        step.plan.status = PlanStatus.APPROVED
        self._run(step.plan).status = PlanStatus.APPROVED
        await self.db.flush()
        return step

    async def reject_step(self, step_id: uuid.UUID) -> PlanStep:
        step = await self.get_step(step_id)
        if step.status != PlanStepStatus.PENDING:
            raise ValueError("Step cannot be rejected")
        step.status = PlanStepStatus.REJECTED
        await self.db.flush()
        return step

    async def execute_step(self, step_id: uuid.UUID) -> PlanStep:
        step = await self.get_step(step_id)
        if step.status != PlanStepStatus.APPROVED or not step.approval_token:
            raise ValueError("Approval required")
        plan = step.plan
        run = self._run(plan)
        plan.status = PlanStatus.EXECUTING
        run.status = PlanStatus.EXECUTING
        run.current_step_order = step.order
        try:
            validator = lambda token: self._valid_token(step.id, token)
            registry = ToolRegistry(self._root(step), validator)
            inputs = {key: value for key, value in step.tool_input.items() if key != "approval_token"}
            if step.tool_name in WRITE_TOOLS:
                inputs["approval_token"] = step.approval_token
            result = await registry.execute(step.tool_name, **inputs)
            self.last_result = result.data
            if not result.success:
                raise RuntimeError(result.error or "Tool execution failed")
            if step.tool_name in WRITE_TOOLS:
                await self._sync_file(step, result.data["content"])
            step.status = PlanStepStatus.EXECUTED
            self._append(run, f"step {step.order} {step.tool_name}: executed")
            if all(item.status in {PlanStepStatus.EXECUTED, PlanStepStatus.REJECTED} for item in plan.steps):
                plan.status = run.status = PlanStatus.COMPLETED
                run.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            return step
        except Exception as exc:
            self.last_result = {"error": str(exc)}
            step.status = PlanStepStatus.FAILED
            plan.status = run.status = PlanStatus.FAILED
            run.completed_at = datetime.now(timezone.utc)
            self._append(run, f"step {step.order} {step.tool_name}: failed: {exc}")
            await self.db.flush()
            return step

    async def _valid_token(self, step_id: uuid.UUID, token: str) -> bool:
        result = await self.db.execute(select(PlanStep).where(PlanStep.id == step_id, PlanStep.approval_token == token, PlanStep.status == PlanStepStatus.APPROVED))
        return result.scalar_one_or_none() is not None

    async def _sync_file(self, step: PlanStep, content: str) -> None:
        if self.workspace_root is not None or settings.STORAGE_PROVIDER != "local":
            return
        workspace = step.plan.project.workspaces[0]
        await FileService(FileRepository(self.db), get_storage_provider()).write_file(workspace.id, step.tool_input["path"], content)

    def _root(self, step: PlanStep) -> Path:
        workspace = step.plan.project.workspaces[0]
        return self.workspace_root or Path(settings.LOCAL_STORAGE_ROOT).resolve() / "workspaces" / str(workspace.id)

    @staticmethod
    def _run(plan: Plan) -> AgentRun:
        return plan.runs[0]

    @staticmethod
    def _append(run: AgentRun, message: str) -> None:
        run.logs = f"{run.logs}\n{message}".strip()
