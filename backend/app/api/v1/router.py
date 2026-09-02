"""Aggregates all v1 routers under a single APIRouter mounted at settings.API_V1_PREFIX."""
from fastapi import APIRouter

from app.api.v1 import auth, chat, chat_stream, files, health, jobs, projects, usage

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(files.router)
api_router.include_router(chat.router)
api_router.include_router(chat_stream.router)
api_router.include_router(jobs.router)
api_router.include_router(usage.router)
