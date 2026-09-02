import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPKMixin


class PlanStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class PlanStepStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    FAILED = "FAILED"


class Plan(Base, UUIDPKMixin):
    __tablename__ = "plans"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[PlanStatus] = mapped_column(Enum(PlanStatus), default=PlanStatus.DRAFT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project = relationship("Project")
    steps: Mapped[list["PlanStep"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="PlanStep.order"
    )
    runs: Mapped[list["AgentRun"]] = relationship(back_populates="plan", cascade="all, delete-orphan")


class PlanStep(Base, UUIDPKMixin):
    __tablename__ = "plan_steps"

    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    tool_input: Mapped[dict] = mapped_column(JSON, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[PlanStepStatus] = mapped_column(Enum(PlanStepStatus), default=PlanStepStatus.PENDING, nullable=False)
    diff_before: Mapped[str | None] = mapped_column(Text, nullable=True)
    diff_after: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)

    plan: Mapped[Plan] = relationship(back_populates="steps")


class AgentRun(Base, UUIDPKMixin):
    __tablename__ = "agent_runs"

    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    current_step_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[PlanStatus] = mapped_column(Enum(PlanStatus), default=PlanStatus.DRAFT, nullable=False)
    logs: Mapped[str] = mapped_column(Text, default="", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    plan: Mapped[Plan] = relationship(back_populates="runs")
