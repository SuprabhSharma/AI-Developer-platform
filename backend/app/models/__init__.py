"""
Import every model module here so `Base.metadata` is fully populated for
Alembic autogeneration (`alembic revision --autogenerate`) and for
`Base.metadata.create_all` used by the test suite's SQLite fixtures.
"""
from app.models.conversation import Conversation, Message, MessageRole  # noqa: F401
from app.models.file import FileRecord, FileType  # noqa: F401
from app.models.git_integration import GitIntegration  # noqa: F401
from app.models.job import Job, JobStatus, JobType  # noqa: F401
from app.models.project import (  # noqa: F401
    Project,
    Repository,
    RepositoryProvider,
    Workspace,
    WorkspaceStatus,
)
from app.models.usage import AIRequest, AIRequestStatus  # noqa: F401
from app.models.user import APIKey, Membership, Organization, OrgRole, User, UserRole  # noqa: F401
