# Database

PostgreSQL, async SQLAlchemy 2.0, Alembic migrations, UUID primary keys throughout.

## Entities
- **User** — auth identity, global role (USER/ADMIN)
- **Organization / Membership** — multi-tenancy anchor; every user gets a personal org at signup
- **Project** — owned by an Organization
- **Workspace** — a project's working copy (1 per project in Phase 1)
- **Repository** — optional git remote metadata for a Workspace
- **FileRecord** — file-tree metadata; bytes live in StorageProvider, not the DB
- **Conversation / Message** — AI chat history per project
- **AIRequest** — per-call usage/cost accounting
- **Job** — generic async job status (indexing, embeddings, test execution)
- **GitIntegration** — OAuth connection metadata
- **APIKey** — user-issued programmatic access keys

## Notes
- Cascading deletes flow Organization → Project → Workspace → File/Repository.
- `uq_file_workspace_path` prevents duplicate paths within a workspace.
- Phase 1's single initial migration creates all tables from ORM metadata; from
  Phase 2 onward, use `alembic revision --autogenerate` for incremental changes.
