# Agent Architecture

```
Agent → ToolRegistry → Tool.execute()
```

`Tool` (app/agents/tools/base.py) declares `name`, `description`, `input_schema`,
and `execute()`. Phase 1 registers only read-only, sandboxed tools:

- `list_files` — directory listing
- `read_file` — capped at `MAX_FILE_READ_BYTES`
- `search_files` — substring search across text files

All three resolve paths through `_safe_join`, which rejects any path that would
escape the workspace root — this is the same sandboxing boundary that write/execute
tools will extend in Phase 5/6, rather than a separate mechanism bolted on later.

No write, delete, or shell-execution tool is registered or reachable from the public
API in this phase. When added, they will go through the same registry interface plus
an isolated worker/sandbox execution path (see security.md).
