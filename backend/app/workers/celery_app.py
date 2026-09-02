"""
Celery application skeleton (Phase 1 foundation only — no tasks execute real
work yet). Repository indexing / embeddings / test execution tasks are added
in Phases 4-6 as separate task modules registered here.
"""
from celery import Celery

from app.core.config import settings

celery_app = Celery("ai_developer_platform", broker=settings.REDIS_URL, backend=settings.REDIS_URL)
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"])
