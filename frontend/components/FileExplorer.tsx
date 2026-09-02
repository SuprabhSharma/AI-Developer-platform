"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { buildTree, isValidMoveTarget, type TreeNode } from "@/lib/fileTree";
import { useFileExplorer } from "@/lib/useFileExplorer";
import FileContextMenu, { type ContextMenuTarget } from "./FileContextMenu";
import FileTreeRenderer from "./FileTreeRenderer";
import type { FileNode } from "@/types/api";

export interface UploadEntry { file: File; path: string; }

interface FileExplorerProps {
  files: FileNode[];
  onSelect: (path: string) => void;
  activePath: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCreateFile: (path: string) => Promise<void>;
  onCreateFolder: (path: string) => Promise<void>;
  onRenameFile: (oldPath: string, newPath: string) => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  onExplainFile?: (path: string) => void;
  onGenerateTests?: (path: string) => void;
  projectName?: string;
  rootName?: string;
  createRequest?: "file" | "folder" | null;
  onCreateRequestHandled?: () => void;
}

export default function FileExplorer({
  files, onSelect, activePath, loading, error, onRetry,
  onCreateFile, onCreateFolder, onRenameFile, onDeleteFile,
  onExplainFile, onGenerateTests, projectName, rootName = "main",
  createRequest, onCreateRequestHandled,
}: FileExplorerProps) {
  const displayProjectName = projectName || "AI Developer Platform";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["__project__", "__main__"]));
  const [selectedPath, setSelectedPath] = useState<string | null>("");
  const [creating, setCreating] = useState<{ type: "file" | "folder"; parentPath: string } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null);
  const [draggingNode, setDraggingNode] = useState<TreeNode | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(files), [files]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((p) => { const n = new Set(p); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  }, []);

  const expandToPath = useCallback((dir: string) => {
    setExpanded((p) => {
      const n = new Set(p); n.add("__project__"); n.add("__main__");
      if (dir) dir.split("/").forEach((_, i, arr) => n.add(arr.slice(0, i + 1).join("/")));
      return n;
    });
  }, []);

  const startCreate = useCallback((type: "file" | "folder", targetDir: string = "") => {
    expandToPath(targetDir);
    setCreating({ type, parentPath: targetDir });
    setRenamingPath(null);
  }, [expandToPath]);

  const handleDelete = useCallback(async (path: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
    setBusy(true);
    try {
      await onDeleteFile(path);
      if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) setSelectedPath("");
    } finally { setBusy(false); }
  }, [onDeleteFile, selectedPath]);

  const { resolveTargetParent, handleKeyDown } = useFileExplorer({
    tree, files, expanded, selectedPath, onSelect, setSelectedPath, setExpanded, setRenamingPath, onDelete: handleDelete,
  });

  useEffect(() => {
    if (createRequest) {
      startCreate(createRequest, resolveTargetParent(selectedPath));
      onCreateRequestHandled?.();
    }
  }, [createRequest, onCreateRequestHandled, resolveTargetParent, selectedPath, startCreate]);

  const handleCreateSubmit = async (name: string) => {
    if (!creating || busy) return;
    const cleanPath = creating.parentPath ? `${creating.parentPath}/${name}` : name;
    setBusy(true);
    try {
      if (creating.type === "file") await onCreateFile(cleanPath); else await onCreateFolder(cleanPath);
      expandToPath(creating.parentPath);
      if (creating.type === "folder") setExpanded((p) => new Set(p).add(cleanPath));
      setSelectedPath(cleanPath);
      setCreating(null);
    } finally { setBusy(false); }
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renamingPath || busy) return;
    const lastSlash = renamingPath.lastIndexOf("/");
    const parent = lastSlash >= 0 ? renamingPath.slice(0, lastSlash) : "";
    const newPath = parent ? `${parent}/${newName}` : newName;
    if (newPath === renamingPath) { setRenamingPath(null); return; }
    setBusy(true);
    try {
      await onRenameFile(renamingPath, newPath);
      setSelectedPath(newPath);
      setRenamingPath(null);
    } finally { setBusy(false); }
  };

  const handleDrop = async (e: React.DragEvent, targetDirPath: string) => {
    e.preventDefault(); e.stopPropagation(); setDragOverTarget(null);
    if (!draggingNode || !isValidMoveTarget(draggingNode.path, draggingNode.file_type === "DIRECTORY", targetDirPath, files)) return;
    const newPath = targetDirPath ? `${targetDirPath}/${draggingNode.name}` : draggingNode.name;
    setBusy(true);
    try {
      await onRenameFile(draggingNode.path, newPath);
      expandToPath(targetDirPath);
      setSelectedPath(newPath);
    } finally { setDraggingNode(null); setBusy(false); }
  };

  const isMainSelected = selectedPath === "" || selectedPath === "__main__";

  return (
    <div className="file-explorer" tabIndex={0} ref={containerRef} onKeyDown={handleKeyDown} onClick={() => setSelectedPath("")}>
      <div className="explorer-header" onClick={(e) => e.stopPropagation()}>
        <span className="explorer-title">EXPLORER</span>
        <div className="explorer-header-actions">
          <button type="button" title="New File" onClick={() => startCreate("file", resolveTargetParent(selectedPath))}><Icon name="plus" size={14} /></button>
          <button type="button" title="New Folder" onClick={() => startCreate("folder", resolveTargetParent(selectedPath))}><Icon name="folder-plus" size={14} /></button>
          {onRetry && <button type="button" title="Refresh" onClick={onRetry}><Icon name="refresh" size={13} /></button>}
          <button type="button" title="Collapse All" onClick={() => setExpanded(new Set(["__project__", "__main__"]))}><Icon name="close" size={13} /></button>
        </div>
      </div>
      <div className="tree-content" onClick={() => setSelectedPath("")}>
        {loading && <div className="tree-loading"><span className="spinner" /> Loading files...</div>}
        {error && <div className="panel-state panel-state-error"><span>{error}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}>Retry</button>}</div>}
        {!loading && !error && (
          <div className="tree-root-container">
            <div className="tree-row tree-row-project" onClick={(e) => { e.stopPropagation(); toggleExpand("__project__"); setSelectedPath(""); }}>
              <span className={`tree-chevron ${expanded.has("__project__") ? "tree-chevron-expanded" : ""}`}><Icon name="chevron-right" size={13} /></span>
              <span className="tree-file-icon text-blue-400"><Icon name="code" size={14} /></span>
              <span className="tree-node-name font-semibold uppercase text-[11px] tracking-wide">{displayProjectName}</span>
            </div>
            {expanded.has("__project__") && (
              <div className="tree-project-contents">
                <div
                  className={`tree-row tree-row-main ${isMainSelected ? "tree-row-selected" : ""} ${dragOverTarget === "" ? "tree-row-drop-target" : ""}`}
                  style={{ paddingLeft: "14px" }}
                  onClick={(e) => { e.stopPropagation(); setSelectedPath(""); }}
                  onDoubleClick={(e) => { e.stopPropagation(); toggleExpand("__main__"); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedPath(""); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: "", name: rootName, file_type: "DIRECTORY", isMain: true } }); }}
                  onDragOver={(e) => { if (draggingNode && isValidMoveTarget(draggingNode.path, draggingNode.file_type === "DIRECTORY", "", files)) { e.preventDefault(); setDragOverTarget(""); } }}
                  onDragLeave={() => setDragOverTarget(null)} onDrop={(e) => handleDrop(e, "")}
                >
                  <span className={`tree-chevron ${expanded.has("__main__") ? "tree-chevron-expanded" : ""}`} onClick={(e) => { e.stopPropagation(); toggleExpand("__main__"); }}><Icon name="chevron-right" size={13} /></span>
                  <span className="tree-file-icon text-amber-400"><Icon name={expanded.has("__main__") ? "folder-open" : "branch"} size={14} /></span>
                  <span className="tree-node-name font-medium">{rootName}</span>
                </div>
                {expanded.has("__main__") && (
                  <div className="tree-main-contents">
                    <FileTreeRenderer
                      nodes={tree} depth={1} files={files} expanded={expanded} creating={creating}
                      renamingPath={renamingPath} busy={busy} selectedPath={selectedPath} activePath={activePath}
                      draggingNode={draggingNode} dragOverTarget={dragOverTarget} onToggle={toggleExpand}
                      onSelect={(p, isD) => { setSelectedPath(p); if (!isD) onSelect(p); else toggleExpand(p); }}
                      onContextMenu={(e, n) => { e.preventDefault(); e.stopPropagation(); setSelectedPath(n.path); setContextMenu({ x: e.clientX, y: e.clientY, target: { path: n.path, name: n.name, file_type: n.file_type } }); }}
                      onDragStart={(e, n) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", n.path); setDraggingNode(n); }}
                      onDragEnd={() => { setDraggingNode(null); setDragOverTarget(null); }}
                      onDragOver={(p) => setDragOverTarget(p)} onDragLeave={() => setDragOverTarget(null)} onDrop={handleDrop}
                      onCreateSubmit={handleCreateSubmit} onCreateCancel={() => setCreating(null)}
                      onRenameSubmit={handleRenameSubmit} onRenameCancel={() => setRenamingPath(null)}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="tree-empty-backdrop" style={{ minHeight: "80px" }} onClick={() => setSelectedPath("")} />
          </div>
        )}
      </div>
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x} y={contextMenu.y} target={contextMenu.target} onClose={() => setContextMenu(null)}
          onNewFile={(parent) => startCreate("file", parent)} onNewFolder={(parent) => startCreate("folder", parent)}
          onRename={(path) => setRenamingPath(path)} onDelete={(path, name) => void handleDelete(path, name)}
          onOpen={(path) => onSelect(path)} onExplainFile={onExplainFile} onGenerateTests={onGenerateTests}
        />
      )}
    </div>
  );
}
