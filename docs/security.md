# Security

## Implemented in Phase 1
- Bcrypt password hashing, JWT access + refresh tokens
- Path-sandboxed file operations (no path traversal outside a workspace root)
- No arbitrary code execution path exists anywhere in the API surface
- Secrets only via environment variables; `.env` is gitignored
- Consistent error envelope; stack traces hidden unless `DEBUG=true`

## Deferred by design (with interfaces already in place)
- `CodeExecutionService.execute()` raises `NotImplementedError` — real
  implementation arrives in Phase 6 behind a Docker sandbox with CPU/memory/time
  limits, filesystem isolation, and network restriction.
- Command allowlists and resource limits are specified in the roadmap, not
  implemented against a live execution path yet, so there is nothing to bypass.

## Future hardening (Phase 8)
- Secrets manager (AWS Secrets Manager) instead of `.env` in production
- Redis-backed rate limiting per endpoint category
- Per-user/per-project AI usage limits, enforced from the `AIRequest` table
