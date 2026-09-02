"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import FileExplorer, { type UploadEntry } from "@/components/FileExplorer";
import CodeEditor from "@/components/CodeEditor";
import ChatPanel, { type FileChatAction } from "@/components/ChatPanel";
import TopNavigation from "@/components/TopNavigation";
import CommandPalette from "@/components/CommandPalette";
import Icon from "@/components/Icon";
import { apiFetch, projectFilePath } from "@/lib/api";
import { getProject, listProjects } from "@/services/projectService";
import { useToast } from "@/components/ToastProvider";
import type { FileNode, Project } from "@/types/api";

type PanelWidths = { explorer: number; chat: number };
const DEFAULT_WIDTHS: PanelWidths = { explorer: 264, chat: 360 };
const PANEL_STORAGE_KEY = "forge-panel-widths";
const AUTOSAVE_DELAY_MS = 300;
type SaveStatus = "saved" | "saving" | "unsaved";

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [reading, setReading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [chatVisible, setChatVisible] = useState(true);
  const [createRequest, setCreateRequest] = useState<"file" | "folder" | null>(null);
  const [chatAction, setChatAction] = useState<FileChatAction | null>(null);
  const [widths, setWidths] = useState<PanelWidths>(DEFAULT_WIDTHS);
  const [widthsReady, setWidthsReady] = useState(false);
  const [dragging, setDragging] = useState<{ side: keyof PanelWidths; startX: number; startWidth: number } | null>(null);
  const activePathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const revisionsRef = useRef(new Map<string, number>());
  const latestContentRef = useRef(new Map<string, string>());
  const saveTimersRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await apiFetch<{ items: FileNode[] }>(`/projects/${projectId}/files`);
      setFiles(res.items);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Could not load the file tree");
    } finally {
      setFilesLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let mounted = true;
    setProjectsLoading(true);
    Promise.all([listProjects(), getProject(projectId)]).then(([projectList, currentProject]) => {
      if (!mounted) return;
      setProjects(projectList.items);
      setProject(currentProject);
    }).catch(() => {
      if (mounted) toast({ tone: "error", message: "Project details could not be loaded." });
    }).finally(() => { if (mounted) setProjectsLoading(false); });
    return () => { mounted = false; };
  }, [projectId, toast]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || "null") as Partial<PanelWidths> | null;
      if (saved && typeof saved.explorer === "number" && typeof saved.chat === "number") {
        setWidths({ explorer: Math.min(Math.max(saved.explorer, 210), 420), chat: Math.min(Math.max(saved.chat, 280), 520) });
      }
    } catch { /* Ignore malformed local preferences. */ }
    setWidthsReady(true);
  }, []);

  useEffect(() => {
    if (widthsReady) localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(widths));
  }, [widths, widthsReady]);

  useEffect(() => {
    if (!dragging) return;
    const activeDrag = dragging;
    function move(event: PointerEvent) {
      const delta = event.clientX - activeDrag.startX;
      setWidths((current) => activeDrag.side === "explorer"
        ? { ...current, explorer: Math.min(Math.max(activeDrag.startWidth + delta, 210), 420) }
        : { ...current, chat: Math.min(Math.max(activeDrag.startWidth - delta, 280), 520) });
    }
    function stop() { setDragging(null); }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
  }, [dragging]);

  const persistFile = useCallback((path: string, snapshot: string, revision: number) => {
    // Queue writes per file. A slow network response for revision N must not
    // arrive after revision N+1 and overwrite the newer editor contents.
    const previous = inFlightRef.current.get(path);
    const operation = (async () => {
      if (previous) await previous;
      if (revisionsRef.current.get(path) !== revision) return;
      if (activePathRef.current === path) setSaveStatus("saving");
      try {
        await apiFetch(projectFilePath(projectId, path), { method: "PUT", body: JSON.stringify({ content: snapshot }) });
        if (revisionsRef.current.get(path) === revision) {
          latestContentRef.current.delete(path);
          if (activePathRef.current === path) setSaveStatus("saved");
        }
      } catch (err) {
        if (activePathRef.current === path && revisionsRef.current.get(path) === revision) {
          setSaveStatus("unsaved");
          toast({ tone: "error", message: err instanceof Error ? err.message : "File save failed." });
        }
      }
    })();
    inFlightRef.current.set(path, operation);
    operation.then(() => {
      if (inFlightRef.current.get(path) === operation) inFlightRef.current.delete(path);
    }, () => {
      if (inFlightRef.current.get(path) === operation) inFlightRef.current.delete(path);
    });
    return operation;
  }, [projectId, toast]);

  const scheduleSave = useCallback((path: string, snapshot: string, revision: number) => {
    const previousTimer = saveTimersRef.current.get(path);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(path);
      void persistFile(path, snapshot, revision);
    }, AUTOSAVE_DELAY_MS);
    saveTimersRef.current.set(path, timer);
  }, [persistFile]);

  const flushPendingSave = useCallback(async (path: string) => {
    const inFlight = inFlightRef.current.get(path);
    if (inFlight) await inFlight;
    const timer = saveTimersRef.current.get(path);
    if (!timer) return;
    window.clearTimeout(timer);
    saveTimersRef.current.delete(path);
    const revision = revisionsRef.current.get(path);
    const snapshot = latestContentRef.current.get(path);
    if (revision !== undefined && snapshot !== undefined) await persistFile(path, snapshot, revision);
  }, [persistFile]);

  useEffect(() => () => {
    saveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current.clear();
    latestContentRef.current.forEach((snapshot, path) => {
      const revision = revisionsRef.current.get(path);
      if (revision !== undefined) void persistFile(path, snapshot, revision);
    });
  }, [persistFile]);

  const openFile = useCallback(async (path: string) => {
    if (activePathRef.current === path) return;

    const previousPath = activePathRef.current;
    if (previousPath) void flushPendingSave(previousPath);

    activePathRef.current = path;
    setActivePath(path);
    const localContent = latestContentRef.current.get(path);
    if (localContent !== undefined) {
      contentRef.current = localContent;
      setContent(localContent);
      setReading(false);
      setSaveStatus(inFlightRef.current.has(path) ? "saving" : "unsaved");
      return;
    }
    setReading(true);
    setSaveStatus("saved");
    try {
      const res = await apiFetch<{ content: string }>(projectFilePath(projectId, path));
      if (activePathRef.current === path) {
        contentRef.current = res.content;
        setContent(res.content);
      }
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Could not open file." });
    } finally {
      if (activePathRef.current === path) setReading(false);
    }
  }, [flushPendingSave, projectId, toast]);

  const handleEditorChange = useCallback((nextContent: string) => {
    const path = activePathRef.current;
    if (!path) return;
    const revision = (revisionsRef.current.get(path) || 0) + 1;
    revisionsRef.current.set(path, revision);
    latestContentRef.current.set(path, nextContent);
    contentRef.current = nextContent;
    setContent(nextContent);
    setSaveStatus("unsaved");
    scheduleSave(path, nextContent, revision);
  }, [scheduleSave]);

  const requestFileAction = useCallback(async (path: string, action: FileChatAction["action"]) => {
    try {
      const localContent = latestContentRef.current.get(path);
      const fileContent = localContent !== undefined
        ? localContent
        : (await apiFetch<{ content: string }>(projectFilePath(projectId, path))).content;
      setChatVisible(true);
      setChatAction({ action, path, code: fileContent });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Could not read file for the assistant." });
    }
  }, [projectId, toast]);

  const createFile = useCallback(async (path: string) => {
    try {
      await apiFetch(projectFilePath(projectId, path), { method: "PUT", body: JSON.stringify({ content: "" }) });
      await loadFiles();
      await openFile(path);
      toast({ tone: "success", message: `${path} created.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "File creation failed." });
      throw err;
    }
  }, [loadFiles, openFile, projectId, toast]);

  const createFolder = useCallback(async (path: string) => {
    try {
      await apiFetch(`/projects/${projectId}/files/folder`, { method: "POST", body: JSON.stringify({ path }) });
      await loadFiles();
      toast({ tone: "success", message: `${path} created.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Folder creation failed." });
      throw err;
    }
  }, [loadFiles, projectId, toast]);

  const renameFile = useCallback(async (path: string, newPath: string) => {
    try {
      if (activePathRef.current === path) await flushPendingSave(path);
      await apiFetch(projectFilePath(projectId, path), { method: "PATCH", body: JSON.stringify({ new_path: newPath }) });
      await loadFiles();
      if (activePathRef.current === path) {
        const localContent = latestContentRef.current.get(path);
        const revision = revisionsRef.current.get(path);
        if (localContent !== undefined) {
          latestContentRef.current.set(newPath, localContent);
          latestContentRef.current.delete(path);
        }
        if (revision !== undefined) {
          revisionsRef.current.set(newPath, revision);
          revisionsRef.current.delete(path);
        }
        activePathRef.current = newPath;
        setActivePath(newPath);
        if (localContent !== undefined && revision !== undefined) scheduleSave(newPath, localContent, revision);
      }
      toast({ tone: "success", message: `${path} renamed.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Rename failed." });
      throw err;
    }
  }, [flushPendingSave, loadFiles, projectId, scheduleSave, toast]);

  const deleteFile = useCallback(async (path: string) => {
    try {
      await flushPendingSave(path);
      await apiFetch<void>(projectFilePath(projectId, path), { method: "DELETE" });
      await loadFiles();
      const timer = saveTimersRef.current.get(path);
      if (timer) window.clearTimeout(timer);
      saveTimersRef.current.delete(path);
      latestContentRef.current.delete(path);
      revisionsRef.current.delete(path);
      if (activePath === path) { activePathRef.current = null; setActivePath(null); contentRef.current = ""; setContent(""); setSaveStatus("saved"); }
      toast({ tone: "success", message: `${path} deleted.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Delete failed." });
      throw err;
    }
  }, [activePath, flushPendingSave, loadFiles, projectId, toast]);

  const uploadFiles = useCallback(async (entries: UploadEntry[]) => {
    const formData = new FormData();
    entries.forEach(({ file, path }) => {
      formData.append("files", file, file.name);
      formData.append("paths", path);
    });
    await apiFetch<{ total: number }>(`/projects/${projectId}/files/upload`, { method: "POST", body: formData });
    await loadFiles();
    toast({ tone: "success", message: `${entries.length} file${entries.length === 1 ? "" : "s"} uploaded.` });
  }, [loadFiles, projectId, toast]);

  const gridTemplate = chatVisible ? `${widths.explorer}px minmax(0, 1fr) ${widths.chat}px` : `${widths.explorer}px minmax(0, 1fr)`;

  return (
    <div className="workspace-shell">
      <TopNavigation projects={projects} currentProject={project} projectsLoading={projectsLoading} onToggleChat={() => setChatVisible((visible) => !visible)} chatVisible={chatVisible} />
      <CommandPalette files={files} onOpenFile={openFile} onNewFile={() => setCreateRequest("file")} onNewProject={() => router.push("/projects?new=1")} onToggleChat={() => setChatVisible((visible) => !visible)} />
      <div className="workspace-toolbar"><div className="workspace-breadcrumb"><span className="breadcrumb-project">{project?.name || "Loading project"}</span><Icon name="chevron-right" size={13} /><span>{activePath || "No file selected"}</span></div><div className="workspace-tools"><span className="command-hint"><Icon name="command" size={13} /> <kbd>⌘ / Ctrl K</kbd> Commands</span>{activePath && <span className={`save-status save-status-${saveStatus}`} role="status"><Icon name={saveStatus === "saved" ? "check" : saveStatus === "saving" ? "refresh" : "x"} size={14} /> {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving…" : "Unsaved changes"}</span>}</div></div>
      <div className="workspace-body" style={{ gridTemplateColumns: gridTemplate }}>
        <aside className="workspace-panel workspace-explorer"><FileExplorer files={files} loading={filesLoading} error={filesError} onRetry={loadFiles} onSelect={openFile} activePath={activePath} onCreateFile={createFile} onCreateFolder={createFolder} onRenameFile={renameFile} onDeleteFile={deleteFile} onExplainFile={(path) => void requestFileAction(path, "explain_code")} onGenerateTests={(path) => void requestFileAction(path, "generate_tests")} onUpload={uploadFiles} createRequest={createRequest} onCreateRequestHandled={() => setCreateRequest(null)} /><div className="panel-resizer panel-resizer-right" onPointerDown={(event) => setDragging({ side: "explorer", startX: event.clientX, startWidth: widths.explorer })} role="separator" aria-label="Resize file explorer" /></aside>
        <section className="workspace-panel workspace-editor"><CodeEditor path={activePath} content={content} onChange={handleEditorChange} loading={reading} /></section>
        {chatVisible && <aside className="workspace-panel workspace-chat"><div className="panel-resizer panel-resizer-left" onPointerDown={(event) => setDragging({ side: "chat", startX: event.clientX, startWidth: widths.chat })} role="separator" aria-label="Resize chat panel" /><ChatPanel projectId={projectId} pendingAction={chatAction} onPendingActionHandled={() => setChatAction(null)} /></aside>}
      </div>
    </div>
  );
}
