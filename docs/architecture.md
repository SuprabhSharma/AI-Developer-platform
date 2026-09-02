# Architecture

## Overview
Modular monolith with four layers: `api` (thin FastAPI routers) → `services` (business
logic) → `repositories` (data access) → `models` (SQLAlchemy ORM). AI and agent
capabilities are isolated behind `AIProvider` and `Tool` interfaces so vendor SDKs
never leak into application code.

## Why a monolith first
Ten users and ten thousand users both need correct business logic before they need
independently scalable services. Splitting `ai/`, `agents/`, and `workers/` into
separate deployables later is a matter of moving folders behind a network boundary,
because they already only communicate through defined interfaces — not shared
in-process state.

## Extraction seams (for future microservices)
- `app/ai/*` → AI Gateway service
- `app/agents/*` → Agent Orchestrator service
- `app/workers/*` → already a separate Celery process
- `app/integrations/git/*` → Git Integration service

## Request flow
Frontend (Next.js) → FastAPI (`/api/v1`) → Service → Repository → PostgreSQL.
AI chat: FastAPI → AIService → AIProvider (Mock/Gemini/Groq/OpenRouter/Ollama) → persisted
Message + AIRequest usage row.
