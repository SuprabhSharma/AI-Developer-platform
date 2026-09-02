"""Placeholder task. Real indexing/embedding/execution tasks arrive in later phases."""
from app.workers.celery_app import celery_app


@celery_app.task(name="workers.ping")
def ping() -> str:
    return "pong"
