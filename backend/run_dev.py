"""
Local dev server entrypoint.

Running `uvicorn app.main:app --reload` directly from this folder watches
the ENTIRE backend directory for changes — including `storage_data/`,
where every project's files actually live on disk. Since opening, saving,
deleting, or agent-applying a file in the UI writes to storage_data/,
uvicorn mistakes that for a source-code change and restarts the whole
server mid-request. That's what makes the app look like "nothing happens"
when you interact with files: the in-flight request gets dropped when the
process restarts underneath it.

This entrypoint tells the reloader to only watch app/ (actual source
code), so workspace file writes never trigger a restart.

Usage (from the backend/ folder):
    python run_dev.py
"""
from pathlib import Path
import platform

import uvicorn


BACKEND_DIR = Path(__file__).resolve().parent
APP_DIR = BACKEND_DIR / "app"
RUNTIME_EXCLUDES = [
    "storage_data/*",
    "dev.db",
]
IS_WINDOWS = platform.system() == "Windows"

if __name__ == "__main__":
    server_options = {
        "host": "127.0.0.1",
        "port": 8000,
        "loop": "asyncio",
    }
    if not IS_WINDOWS:
        server_options.update(
            reload=True,
            reload_dirs=[str(APP_DIR)],
            reload_excludes=RUNTIME_EXCLUDES,
        )

    # Uvicorn's multiprocessing reloader can leave a Windows IOCP socket
    # behind while a workspace file is being written. Source changes can be
    # picked up by restarting this process; workspace changes must never
    # restart the API server.
    uvicorn.run("app.main:app", **server_options)
