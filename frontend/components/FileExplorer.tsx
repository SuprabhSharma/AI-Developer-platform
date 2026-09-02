"use client";
import type { FileNode } from "@/types/api";

export default function FileExplorer({ files, onSelect, activePath }: { files: FileNode[]; onSelect: (path: string) => void; activePath: string | null }) {
  return (
    <div className="h-full overflow-y-auto p-2 text-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500 px-2 pb-2">Files</p>
      {files.length === 0 && <p className="text-xs text-neutral-600 px-2">No files yet</p>}
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => f.file_type === "FILE" && onSelect(f.path)}
          className={`block w-full text-left px-2 py-1 rounded ${activePath === f.path ? "bg-graphite-600 text-signal" : "hover:bg-graphite-700"}`}
        >
          {f.file_type === "DIRECTORY" ? "📁" : "📄"} {f.path}
        </button>
      ))}
    </div>
  );
}
