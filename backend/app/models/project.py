import enum
import uuid

from sqlalchemy import Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Project(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("organization_id", "slug", name="uq_project_org_slug"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="projects")
    workspaces: Mapped[list["Workspace"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class WorkspaceStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class Workspace(Base, UUIDPKMixin, TimestampMixin):
    """
    A workspace is the working copy of a project's files (analogous to a codespace).
    Kept separate from Project so a project can eventually host multiple workspaces
    (e.g. per-branch or per-user sandboxes).
    """
    __tablename__ = "workspaces"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="main", nullable=False)
    status: Mapped[WorkspaceStatus] = mapped_column(Enum(WorkspaceStatus), default=WorkspaceStatus.ACTIVE)

    project: Mapped["Project"] = relationship(back_populates="workspaces")
    repository: Mapped["Repository | None"] = relationship(back_populates="workspace", uselist=False, cascade="all, delete-orphan")
    files: Mapped[list["FileRecord"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class RepositoryProvider(str, enum.Enum):
    NONE = "NONE"        # files uploaded directly, no git remote
    GITHUB = "GITHUB"
    GITLAB = "GITLAB"


class Repository(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "repositories"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True, index=True)
    provider: Mapped[RepositoryProvider] = mapped_column(Enum(RepositoryProvider), default=RepositoryProvider.NONE)
    remote_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    default_branch: Mapped[str] = mapped_column(String(255), default="main")
    last_indexed_at: Mapped[str | None] = mapped_column(String(64), nullable=True)

    workspace: Mapped["Workspace"] = relationship(back_populates="repository")
