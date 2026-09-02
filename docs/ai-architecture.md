# AI Architecture

```
Route → AIService → AIProvider interface → concrete provider (Mock/Gemini/Groq/OpenRouter/Ollama) → LLM API
```

`AIProvider` (app/ai/provider.py) declares `chat()`, `stream_chat()`, and capability
methods (`generate_code`, `explain_code`, `analyze_code`, `generate_tests`). Mock,
Gemini, Groq, and OpenRouter implement the three Phase 3 capabilities. `app/ai/factory.py` selects
the concrete provider from `AI_PROVIDER`; if a key is missing for a paid provider it
falls back to `MockProvider` rather than crashing the app.

Usage accounting (`AIRequest`) is written on every call regardless of provider, with
nullable token/cost fields since providers don't report identical accounting info.
Gemini and Groq streams are consumed directly from their native SSE endpoints, and
the API forwards structured token events through `/chat/stream`.

## Repository-aware AI (Phase 4, interfaces only today)
```
Repository → file discovery → chunking → embeddings → pgvector → semantic search → LLM context
```
`EmbeddingService`, `VectorStore`, `RepositoryIndexer`, `CodeChunker`, and
`SemanticSearchService` are the planned abstractions; pgvector was chosen over a
separate Chroma/FAISS deployment to avoid a second piece of infrastructure.
