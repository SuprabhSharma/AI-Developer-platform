# Security

## Implemented
- Bcrypt password hashing, JWT access + refresh tokens
- Path-sandboxed file operations (no path traversal outside a workspace root)
- No arbitrary code execution path exists anywhere in the API surface
- Secrets only via environment variables; `.env` is gitignored
- Consistent error envelope; stack traces hidden unless `DEBUG=true`
- Redis-backed atomic sliding-window AI limits per user and project, returning 429

## Deferred by design (with interfaces already in place)
- `CodeExecutionService.execute()` raises `NotImplementedError` — real
  implementation arrives in Phase 6 behind a Docker sandbox with CPU/memory/time
  limits, filesystem isolation, and network restriction.
- Command allowlists and resource limits are specified in the roadmap, not
  implemented against a live execution path yet, so there is nothing to bypass.

## Future hardening
- Secrets manager (AWS Secrets Manager) instead of `.env` in production
- Rate limits for non-AI endpoint categories
