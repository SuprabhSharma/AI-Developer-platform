# AI Architecture

```
Route → AIService → AIProvider interface → concrete provider (Mock/Gemini/Groq/Ollama) → LLM API
```

`AIProvider` (app/ai/provider.py) declares `chat()`, `stream_chat()`, and placeholder
methods (`generate_code`, `explain_code`, `analyze_code`, `generate_tests`) that raise
`NotImplementedError` until their respective phase lands. `app/ai/factory.py` selects
the concrete provider from `AI_PROVIDER`; if a key is missing for a paid provider it
falls back to `MockProvider` rather than crashing the app.

Usage accounting (`AIRequest`) is written on every call regardless of provider, with
nullable token/cost fields since providers don't report identical accounting info.

## Repository-aware AI (Phase 4, interfaces only today)
```
Repository → file discovery → chunking → embeddings → pgvector → semantic search → LLM context
```
`EmbeddingService`, `VectorStore`, `RepositoryIndexer`, `CodeChunker`, and
`SemanticSearchService` are the planned abstractions; pgvector was chosen over a
separate Chroma/FAISS deployment to avoid a second piece of infrastructure.
