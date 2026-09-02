import enum
import uuid

from sqlalchemy import BigInteger, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class FileType(str, enum.Enum):
    FILE = "FILE"
    DIRECTORY = "DIRECTORY"


class FileRecord(Base, UUIDPKMixin, TimestampMixin):
    """
    Metadata row per file/directory in a workspace. Actual bytes live behind
    StorageProvider (local disk in dev, S3 later) — this table never stores content,
    only the storage_key pointer, so switching storage backends needs no data migration
    beyond the objects themselves.
    """
    __tablename__ = "files"
    __table_args__ = (UniqueConstraint("workspace_id", "path", name="uq_file_workspace_path"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    path: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)  # relative path, e.g. "src/app.py"
    file_type: Mapped[FileType] = mapped_column(Enum(FileType), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # null for directories
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # sha256, for change detection

    workspace: Mapped["Workspace"] = relationship(back_populates="files")
