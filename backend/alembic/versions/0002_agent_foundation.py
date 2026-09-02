"""add the Phase 5 coding-agent foundation

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    plan_status = sa.Enum("DRAFT", "APPROVED", "EXECUTING", "COMPLETED", "FAILED", name="planstatus")
    step_status = sa.Enum("PENDING", "APPROVED", "REJECTED", "EXECUTED", "FAILED", name="planstepstatus")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        plan_status.create(bind, checkfirst=True)
        step_status.create(bind, checkfirst=True)
    op.create_table(
        "plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_description", sa.Text(), nullable=False),
        sa.Column("status", plan_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_plans_project_id", "plans", ["project_id"])
    op.create_index("ix_plans_user_id", "plans", ["user_id"])
    op.create_table(
        "plan_steps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("tool_name", sa.String(64), nullable=False),
        sa.Column("tool_input", sa.JSON(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", step_status, nullable=False),
        sa.Column("diff_before", sa.Text()),
        sa.Column("diff_after", sa.Text()),
        sa.Column("approval_token", sa.String(64), unique=True),
    )
    op.create_index("ix_plan_steps_plan_id", "plan_steps", ["plan_id"])
    op.create_table(
        "agent_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", UUID(as_uuid=True), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("current_step_order", sa.Integer(), nullable=False),
        sa.Column("status", plan_status, nullable=False),
        sa.Column("logs", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_agent_runs_plan_id", "agent_runs", ["plan_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_runs_plan_id", table_name="agent_runs")
    op.drop_table("agent_runs")
    op.drop_index("ix_plan_steps_plan_id", table_name="plan_steps")
    op.drop_table("plan_steps")
    op.drop_index("ix_plans_user_id", table_name="plans")
    op.drop_index("ix_plans_project_id", table_name="plans")
    op.drop_table("plans")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum(name="planstepstatus").drop(bind, checkfirst=True)
        sa.Enum(name="planstatus").drop(bind, checkfirst=True)
