"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type { FileNode } from "@/types/api";
import Icon from "@/components/Icon";

export interface UploadEntry {
  file: File;
  path: string;
}

type FileOperation = (path: string) => Promise<void>;
type TreeNode = FileNode & { name: string; children: TreeNode[]; synthetic?: boolean };
type FlatNode = { node: TreeNode; level: number };

interface FileExplorerProps {
  files: FileNode[];
  onSelect: (path: string) => void;
  activePath: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCreateFile: FileOperation;
  onCreateFolder: FileOperation;
  onRenameFile: (path: string, newPath: string) => Promise<void>;
  onDeleteFile: FileOperation;
  onExplainFile?: (path: string) => void;
  onGenerateTests?: (path: string) => void;
  onUpload: (entries: UploadEntry[]) => Promise<void>;
  createRequest?: "file" | "folder" | null;
  onCreateRequestHandled?: () => void;
}

function makeTree(files: FileNode[]) {
  const root: TreeNode = { path: "", name: "", file_type: "DIRECTORY", size_bytes: 0, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let cursor = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = cursor.children.find((node) => node.name === part);
      if (!child) {
        child = { path, name: part, file_type: index === parts.length - 1 ? file.file_type : "DIRECTORY", size_bytes: 0, children: [], synthetic: index !== parts.length - 1 };
        cursor.children.push(child);
      }
      if (index === parts.length - 1) Object.assign(child, file, { name: part });
      cursor = child;
    });
  }
  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => Number(b.file_type === "DIRECTORY") - Number(a.file_type === "DIRECTORY") || a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  }
  sort(root.children);
  return root.children;
}

function flattenVisibleTree(nodes: TreeNode[], expanded: Set<string>, query: string): FlatNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (node: TreeNode) => !normalizedQuery || node.name.toLowerCase().includes(normalizedQuery) || node.path.toLowerCase().includes(normalizedQuery);
  const hasMatch = (node: TreeNode): boolean => matches(node) || node.children.some(hasMatch);
  const flattened: FlatNode[] = [];

  function visit(currentNodes: TreeNode[], level: number) {
    currentNodes.forEach((node) => {
      if (normalizedQuery && !hasMatch(node)) return;
      flattened.push({ node, level });
      const shouldOpen = normalizedQuery ? hasMatch(node) : expanded.has(node.path);
      if (node.file_type === "DIRECTORY" && shouldOpen) visit(node.children, level + 1);
    });
  }

  visit(nodes, 0);
  return flattened;
}

type BrowserFile = File & { webkitRelativePath?: string };
type FileSystemEntryLike = { isFile: boolean; isDirectory: boolean; name: string };
type FileSystemFileEntryLike = FileSystemEntryLike & { file: (success: (file: File) => void, error?: (error: DOMException) => void) => void };
type FileSystemDirectoryEntryLike = FileSystemEntryLike & { createReader: () => { readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void } };

function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(entry: FileSystemDirectoryEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader();
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntryLike[] = [];
    const readBatch = () => reader.readEntries((batch) => {
      if (batch.length === 0) resolve(entries);
      else {
        entries.push(...batch);
        readBatch();
      }
    }, reject);
    readBatch();
  });
}

async function walkDroppedEntry(entry: FileSystemEntryLike, prefix: string): Promise<UploadEntry[]> {
  const path = `${prefix}${entry.name}`;
  if (entry.isFile) return [{ file: await readFileEntry(entry as FileSystemFileEntryLike), path }];
  if (!entry.isDirectory) return [];
  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntryLike);
  const nested = await Promise.all(children.map((child) => walkDroppedEntry(child, `${path}/`)));
  return nested.flat();
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<UploadEntry[]> {
  const entries = Array.from(dataTransfer.items).reduce<FileSystemEntryLike[]>((result, item) => {
    if (item.kind !== "file") return result;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.();
    if (entry) result.push(entry);
    return result;
  }, []);
  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((entry) => walkDroppedEntry(entry, "")));
    return nested.flat();
  }
  return Array.from(dataTransfer.files).map((file) => ({ file, path: (file as BrowserFile).webkitRelativePath || file.name }));
}

export default function FileExplorer({ files, onSelect, activePath, loading = false, error, onRetry, onCreateFile, onCreateFolder, onRenameFile, onDeleteFile, onExplainFile, onGenerateTests, onUpload, createRequest, onCreateRequestHandled }: FileExplorerProps) {
  const [createType, setCreateType] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const uploadFilesInputRef = useRef<HTMLInputElement>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement>(null);
  const treeContentRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => makeTree(files), [files]);
  const visibleNodes = useMemo(() => flattenVisibleTree(tree, expanded, searchQuery), [tree, expanded, searchQuery]);

  useEffect(() => {
    const element = treeContentRef.current;
    if (!element) return;
    const updateSize = () => setTreeSize({ width: element.clientWidth - 10, height: element.clientHeight - 18 });
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchQuery(searchInput), 200);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      files.forEach((file) => {
        const parts = file.path.split("/");
        for (let index = 1; index < parts.length; index += 1) next.add(parts.slice(0, index).join("/"));
      });
      return next;
    });
  }, [files]);

  useEffect(() => {
    if (createRequest) {
      setCreateType(createRequest);
      setNewName("");
      onCreateRequestHandled?.();
      window.setTimeout(() => createInputRef.current?.focus(), 0);
    }
  }, [createRequest, onCreateRequestHandled]);

  function beginCreate(type: "file" | "folder") {
    setCreateType(type);
    setNewName("");
    window.setTimeout(() => createInputRef.current?.focus(), 0);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    const path = newName.trim();
    if (!createType || !path || busy) return;
    setBusy(true);
    try {
      await (createType === "file" ? onCreateFile(path) : onCreateFolder(path));
      setCreateType(null);
      setNewName("");
    } catch {
      // The parent owns the toast; keep the form open so the path can be corrected.
    } finally {
      setBusy(false);
    }
  }

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    if (!renamePath || !renameName.trim() || busy) return;
    setBusy(true);
    try {
      const parent = renamePath.includes("/") ? `${renamePath.slice(0, renamePath.lastIndexOf("/") + 1)}` : "";
      await onRenameFile(renamePath, `${parent}${renameName.trim()}`);
      setRenamePath(null);
    } catch {
      // The parent owns the toast; keep the inline editor open.
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile(path: string) {
    if (!window.confirm(`Delete ${path}? This cannot be undone.`)) return;
    setBusy(true);
    try { await onDeleteFile(path); } catch { /* The parent owns the toast. */ } finally { setBusy(false); setContextMenu(null); }
  }

  async function uploadEntries(entries: UploadEntry[]) {
    const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.path, entry])).values());
    if (uniqueEntries.length === 0 || uploading) return;
    setUploading(true);
    try {
      await onUpload(uniqueEntries);
    } catch {
      // The parent owns the toast.
    } finally {
      setUploading(false);
      setDropActive(false);
    }
  }

  function handleInputUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const entries = Array.from(event.target.files || []).map((file) => ({ file, path: (file as BrowserFile).webkitRelativePath || file.name }));
    event.currentTarget.value = "";
    void uploadEntries(entries);
  }

  function renderNode(node: TreeNode, level: number) {
    const isDirectory = node.file_type === "DIRECTORY";
    const isOpen = expanded.has(node.path);
    const isRenaming = renamePath === node.path;
    return isRenaming ? (
      <form className="tree-rename" onSubmit={submitRename} style={{ paddingLeft: `${10 + level * 14}px` }}>
        <Icon name="file" size={15} /><input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setRenamePath(null)} aria-label={`Rename ${node.name}`} /><button type="submit" disabled={busy} aria-label="Save name"><Icon name="check" size={14} /></button>
      </form>
    ) : (
      <button type="button" className={`tree-row ${activePath === node.path ? "tree-row-active" : ""}`} style={{ paddingLeft: `${8 + level * 14}px` }} onClick={() => isDirectory ? setExpanded((current) => { const next = new Set(current); isOpen ? next.delete(node.path) : next.add(node.path); return next; }) : onSelect(node.path)} onContextMenu={(event) => { if (isDirectory || node.synthetic) return; event.preventDefault(); setContextMenu({ path: node.path, x: event.clientX, y: event.clientY }); }}>
        <span className="tree-chevron">{isDirectory && <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={13} />}</span><span className={`tree-file-icon ${isDirectory ? "tree-folder-icon" : ""}`}><Icon name={isDirectory ? "folder" : "file"} size={15} /></span><span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div className="file-explorer" onClick={() => contextMenu && setContextMenu(null)}>
      <div className="panel-heading"><div><p className="eyebrow">Workspace</p><h2>Files</h2></div><div className="file-actions"><button type="button" className="icon-button" onClick={() => beginCreate("file")} title="New file" aria-label="New file"><Icon name="plus" size={16} /></button><button type="button" className="icon-button" onClick={() => beginCreate("folder")} title="New folder" aria-label="New folder"><Icon name="folder-plus" size={16} /></button></div></div>
      <div className="tree-search"><Icon name="search" size={14} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Filter files" aria-label="Filter files" /></div>
      <div className={`upload-zone ${dropActive ? "upload-zone-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDrop={(event) => { event.preventDefault(); void collectDroppedFiles(event.dataTransfer).then(uploadEntries).catch(() => setDropActive(false)); }}>
        <input ref={uploadFilesInputRef} type="file" multiple hidden onChange={handleInputUpload} />
        <input ref={uploadFolderInputRef} type="file" multiple hidden onChange={handleInputUpload} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
        <span><Icon name="plus" size={13} /> {uploading ? "Uploading…" : "Drop files or folders here"}</span>
        <div className="upload-actions"><button type="button" onClick={() => uploadFilesInputRef.current?.click()} disabled={uploading}>Choose files</button><button type="button" onClick={() => uploadFolderInputRef.current?.click()} disabled={uploading}>Choose folder</button></div>
      </div>
      {createType && <form className="inline-create" onSubmit={submitCreate}><div className="inline-create-label"><Icon name={createType === "file" ? "file" : "folder"} size={14} /><span>New {createType}</span></div><input ref={createInputRef} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={createType === "file" ? "path/to/file.ts" : "path/to/folder"} onKeyDown={(event) => event.key === "Escape" && setCreateType(null)} aria-label={`New ${createType} path`} /><button type="submit" disabled={busy || !newName.trim()} aria-label={`Create ${createType}`}><Icon name="check" size={15} /></button></form>}
      <div ref={treeContentRef} className="tree-content" aria-busy={loading}>
        {loading && <div className="tree-loading"><span className="spinner" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line skeleton-short" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-short skeleton-line" /></div>}
        {!loading && error && <div className="panel-state panel-state-error"><Icon name="x" size={18} /><strong>Files are unavailable</strong><span>{error}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}><Icon name="refresh" size={13} /> Try again</button>}</div>}
        {!loading && !error && files.length === 0 && <div className="panel-state"><span className="empty-icon"><Icon name="folder" size={20} /></span><strong>This workspace is empty</strong><span>Create a file or folder to get started.</span></div>}
        {!loading && !error && files.length > 0 && visibleNodes.length === 0 && <div className="panel-state"><Icon name="search" size={18} /><strong>No matching files</strong><span>Try a different search.</span></div>}
        {!loading && !error && visibleNodes.length > 0 && treeSize.height > 0 && <FixedSizeList height={Math.max(treeSize.height, 1)} width={Math.max(treeSize.width, 1)} itemCount={visibleNodes.length} itemSize={31} itemData={visibleNodes} itemKey={(index, data) => data[index].node.path}>{({ index, style, data }: ListChildComponentProps<FlatNode[]>) => <div style={style}>{renderNode(data[index].node, data[index].level)}</div>}</FixedSizeList>}
      </div>
      {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>{onExplainFile && <button type="button" onClick={() => { onExplainFile(contextMenu.path); setContextMenu(null); }}><Icon name="sparkle" size={14} /> Explain this code</button>}{onGenerateTests && <button type="button" onClick={() => { onGenerateTests(contextMenu.path); setContextMenu(null); }}><Icon name="check" size={14} /> Generate tests</button>}<button type="button" onClick={() => { setRenamePath(contextMenu.path); setRenameName(contextMenu.path.split("/").pop() || contextMenu.path); setContextMenu(null); }}><Icon name="file" size={14} /> Rename</button><button type="button" className="context-danger" onClick={() => deleteFile(contextMenu.path)}><Icon name="trash" size={14} /> Delete</button></div>}
    </div>
  );
}
