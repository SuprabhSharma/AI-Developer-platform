"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import FileExplorer from "@/components/FileExplorer";
import CodeEditor from "@/components/CodeEditor";
import ChatPanel from "@/components/ChatPanel";
import { apiFetch } from "@/lib/api";
import type { FileNode } from "@/types/api";

export default function WorkspacePage() {
  const params = useParams();
  const projectId = params.id as string;

  const [files, setFiles] = useState<FileNode[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ items: FileNode[] }>(`/projects/${projectId}/files`).then((res) => setFiles(res.items));
  }, [projectId]);

  async function openFile(path: string) {
    setActivePath(path);
    const res = await apiFetch<{ content: string }>(`/projects/${projectId}/files/${path}`);
    setContent(res.content);
  }

  async function saveFile() {
    if (!activePath) return;
    setSaving(true);
    await apiFetch(`/projects/${projectId}/files/${activePath}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    setSaving(false);
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 flex items-center justify-between px-4 border-b border-graphite-600 bg-graphite-800">
        <span className="text-sm font-medium text-signal">AI Developer Platform</span>
        {activePath && (
          <button onClick={saveFile} disabled={saving} className="text-xs bg-graphite-700 border border-graphite-600 rounded px-3 py-1 hover:border-signal">
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </header>
      <div className="flex-1 grid grid-cols-[220px_1fr_320px]">
        <aside className="border-r border-graphite-600 bg-graphite-800">
          <FileExplorer files={files} onSelect={openFile} activePath={activePath} />
        </aside>
        <section className="bg-graphite-900">
          <CodeEditor path={activePath} content={content} onChange={setContent} />
        </section>
        <aside className="border-l border-graphite-600 bg-graphite-800">
          <ChatPanel projectId={projectId} />
        </aside>
      </div>
    </div>
  );
}
