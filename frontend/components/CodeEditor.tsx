"use client";
import Editor from "@monaco-editor/react";

export default function CodeEditor({ path, content, onChange }: { path: string | null; content: string; onChange: (v: string) => void }) {
  if (!path) {
    return <div className="h-full flex items-center justify-center text-sm text-neutral-500">Select a file to start editing</div>;
  }
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      path={path}
      value={content}
      onChange={(v) => onChange(v || "")}
      options={{ fontSize: 13, minimap: { enabled: false } }}
    />
  );
}
