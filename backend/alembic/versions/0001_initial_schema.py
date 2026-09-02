"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-01
"""
from alembic import op

from app.db.base import Base
import app.models  # noqa: F401 — registers all tables on Base.metadata

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Phase 1 pragmatic choice: create every table from the ORM metadata in one
    # migration rather than hand-writing ~12 create_table() calls that would
    # just duplicate what the models already declare. From Phase 2 onward,
    # `alembic revision --autogenerate` produces normal incremental migrations
    # diffed against this baseline.
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
