"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import FileExplorer, { type UploadEntry } from "@/components/FileExplorer";
import CodeEditor from "@/components/CodeEditor";
import ChatPanel, { type FileChatAction } from "@/components/ChatPanel";
import AgentPanel from "@/components/AgentPanel";
import TopNavigation from "@/components/TopNavigation";
import CommandPalette from "@/components/CommandPalette";
import TerminalPanel from "@/components/TerminalPanel";
import Icon from "@/components/Icon";
import { apiFetch, projectFilePath } from "@/lib/api";
import { getProject, listProjects } from "@/services/projectService";
import { useToast } from "@/components/ToastProvider";
import type { FileNode, Project } from "@/types/api";

type PanelWidths = { explorer: number; chat: number };
const DEFAULT_WIDTHS: PanelWidths = { explorer: 264, chat: 360 };
const PANEL_STORAGE_KEY = "forge-panel-widths";
const AUTOSAVE_DELAY_MS = 600;
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

  // VS Code Multi-tab and Editor State
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const [content, setContent] = useState("");
  const [reading, setReading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const [chatVisible, setChatVisible] = useState(true);
  const [panelTab, setPanelTab] = useState<"chat" | "agent">("chat");
  const [createRequest, setCreateRequest] = useState<"file" | "folder" | null>(null);
  const [chatAction, setChatAction] = useState<FileChatAction | null>(null);
  const [widths, setWidths] = useState<PanelWidths>(DEFAULT_WIDTHS);
  const [widthsReady, setWidthsReady] = useState(false);
  const [dragging, setDragging] = useState<{ side: keyof PanelWidths; startX: number; startWidth: number } | null>(null);

  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const terminalDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onTerminalDrag = useCallback((e: PointerEvent) => {
    if (!terminalDragRef.current) return;
    const delta = terminalDragRef.current.startY - e.clientY;
    setTerminalHeight(Math.min(Math.max(terminalDragRef.current.startH + delta, 120), 600));
  }, []);

  const stopTerminalDrag = useCallback(() => {
    terminalDragRef.current = null;
    document.removeEventListener("pointermove", onTerminalDrag);
    document.removeEventListener("pointerup", stopTerminalDrag);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onTerminalDrag]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTerminalVisible((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activePathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const openTabsRef = useRef<string[]>([]);
  const tabContentsRef = useRef(new Map<string, string>());
  const savedContentsRef = useRef(new Map<string, string>());
  const revisionsRef = useRef(new Map<string, number>());
  const saveTimersRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const initialRestoreDoneRef = useRef(false);

  openTabsRef.current = openTabs;

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await apiFetch<{ items: FileNode[] }>(`/projects/${projectId}/files`);
      setFiles(res.items);
      return res.items;
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Could not load the file tree");
      return [];
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

  // Load panel widths preference
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

  // Handle panel resizing
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
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  const persistFile = useCallback((path: string, snapshot: string, revision: number, showToast = false) => {
    const previous = inFlightRef.current.get(path);
    const operation = (async () => {
      if (previous) await previous;
      if (revisionsRef.current.get(path) !== revision) return;
      if (activePathRef.current === path) setSaveStatus("saving");
      try {
        await apiFetch(projectFilePath(projectId, path), { method: "PUT", body: JSON.stringify({ content: snapshot }) });
        if (revisionsRef.current.get(path) === revision) {
          savedContentsRef.current.set(path, snapshot);
          setDirtyPaths((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
          if (activePathRef.current === path) setSaveStatus("saved");
          if (showToast) toast({ tone: "success", message: `Saved ${path}` });
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
    const timer = saveTimersRef.current.get(path);
    if (timer) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(path);
    }
    const revision = revisionsRef.current.get(path);
    const snapshot = tabContentsRef.current.get(path);
    if (revision !== undefined && snapshot !== undefined) {
      await persistFile(path, snapshot, revision);
    }
  }, [persistFile]);

  const handleManualSave = useCallback(() => {
    const path = activePathRef.current;
    if (!path) return;
    const current = tabContentsRef.current.get(path) ?? contentRef.current;
    const revision = (revisionsRef.current.get(path) || 0) + 1;
    revisionsRef.current.set(path, revision);
    const timer = saveTimersRef.current.get(path);
    if (timer) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(path);
    }
    void persistFile(path, current, revision, true);
  }, [persistFile]);

  // Open a file into editor tabs
  const openFile = useCallback(async (path: string) => {
    // Add to open tabs if not already present
    setOpenTabs((prev) => {
      if (prev.includes(path)) return prev;
      const next = [...prev, path];
      try {
        localStorage.setItem(`forge-open-tabs-${projectId}`, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });

    try {
      localStorage.setItem(`forge-active-tab-${projectId}`, path);
    } catch { /* ignore */ }

    if (activePathRef.current === path) return;

    activePathRef.current = path;
    setActivePath(path);

    // If we already have the modified or loaded content cached in memory
    const localContent = tabContentsRef.current.get(path);
    if (localContent !== undefined) {
      contentRef.current = localContent;
      setContent(localContent);
      setReading(false);
      const isDirty = localContent !== (savedContentsRef.current.get(path) ?? "");
      setSaveStatus(isDirty ? "unsaved" : inFlightRef.current.has(path) ? "saving" : "saved");
      return;
    }

    setReading(true);
    setSaveStatus("saved");
    try {
      const res = await apiFetch<{ content: string }>(projectFilePath(projectId, path));
      if (activePathRef.current === path) {
        tabContentsRef.current.set(path, res.content);
        savedContentsRef.current.set(path, res.content);
        contentRef.current = res.content;
        setContent(res.content);
      }
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Could not open file." });
    } finally {
      if (activePathRef.current === path) setReading(false);
    }
  }, [projectId, toast]);

  // Close an open tab
  const closeTab = useCallback((path: string) => {
    void flushPendingSave(path);

    const currentTabs = openTabsRef.current;
    const index = currentTabs.indexOf(path);
    if (index === -1) return;

    const nextTabs = currentTabs.filter((t) => t !== path);
    setOpenTabs(nextTabs);
    try {
      localStorage.setItem(`forge-open-tabs-${projectId}`, JSON.stringify(nextTabs));
    } catch { /* ignore */ }

    // If closing the active tab, select a neighbor
    if (activePathRef.current === path) {
      if (nextTabs.length > 0) {
        const nextIdx = Math.min(index, nextTabs.length - 1);
        void openFile(nextTabs[nextIdx]);
      } else {
        activePathRef.current = null;
        setActivePath(null);
        contentRef.current = "";
        setContent("");
        setSaveStatus("saved");
        try {
          localStorage.removeItem(`forge-active-tab-${projectId}`);
        } catch { /* ignore */ }
      }
    }
  }, [flushPendingSave, openFile, projectId]);

  // Initial load and restoration of workspace tabs from localStorage
  useEffect(() => {
    loadFiles().then((loadedFiles) => {
      if (initialRestoreDoneRef.current || !loadedFiles) return;
      initialRestoreDoneRef.current = true;

      try {
        const savedTabsRaw = localStorage.getItem(`forge-open-tabs-${projectId}`);
        const savedActive = localStorage.getItem(`forge-active-tab-${projectId}`);
        const validFilePaths = new Set(loadedFiles.filter((f) => f.file_type === "FILE").map((f) => f.path));

        let restoredTabs: string[] = [];
        if (savedTabsRaw) {
          const parsed = JSON.parse(savedTabsRaw) as string[];
          restoredTabs = parsed.filter((p) => validFilePaths.has(p));
        }

        if (restoredTabs.length > 0) {
          setOpenTabs(restoredTabs);
          const targetActive = (savedActive && restoredTabs.includes(savedActive)) ? savedActive : restoredTabs[0];
          void openFile(targetActive);
        }
      } catch { /* Ignore restoration issues */ }
    });
  }, [loadFiles, openFile, projectId]);

  const handleEditorChange = useCallback((nextContent: string) => {
    const path = activePathRef.current;
    if (!path) return;

    tabContentsRef.current.set(path, nextContent);
    contentRef.current = nextContent;
    setContent(nextContent);

    const savedContent = savedContentsRef.current.get(path);
    const isDirty = savedContent === undefined || savedContent !== nextContent;

    setDirtyPaths((prev) => {
      const next = new Set(prev);
      if (isDirty) next.add(path);
      else next.delete(path);
      return next;
    });

    setSaveStatus(isDirty ? "unsaved" : "saved");

    const revision = (revisionsRef.current.get(path) || 0) + 1;
    revisionsRef.current.set(path, revision);
    scheduleSave(path, nextContent, revision);
  }, [scheduleSave]);

  const requestFileAction = useCallback(async (path: string, action: FileChatAction["action"]) => {
    try {
      const localContent = tabContentsRef.current.get(path);
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
      tabContentsRef.current.set(path, "");
      savedContentsRef.current.set(path, "");
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
      await flushPendingSave(path);
      await apiFetch(projectFilePath(projectId, path), { method: "PATCH", body: JSON.stringify({ new_path: newPath }) });
      await loadFiles();

      // Update open tabs
      setOpenTabs((prev) => {
        const next = prev.map((t) => {
          if (t === path) return newPath;
          if (t.startsWith(`${path}/`)) return `${newPath}${t.slice(path.length)}`;
          return t;
        });
        try {
          localStorage.setItem(`forge-open-tabs-${projectId}`, JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });

      // Migrate cached content
      const migratePath = (oldP: string, newP: string) => {
        const c = tabContentsRef.current.get(oldP);
        if (c !== undefined) {
          tabContentsRef.current.set(newP, c);
          tabContentsRef.current.delete(oldP);
        }
        const s = savedContentsRef.current.get(oldP);
        if (s !== undefined) {
          savedContentsRef.current.set(newP, s);
          savedContentsRef.current.delete(oldP);
        }
        const r = revisionsRef.current.get(oldP);
        if (r !== undefined) {
          revisionsRef.current.set(newP, r);
          revisionsRef.current.delete(oldP);
        }
        setDirtyPaths((prev) => {
          if (!prev.has(oldP)) return prev;
          const next = new Set(prev);
          next.delete(oldP);
          next.add(newP);
          return next;
        });
      };

      migratePath(path, newPath);

      if (activePathRef.current === path) {
        activePathRef.current = newPath;
        setActivePath(newPath);
      } else if (activePathRef.current && activePathRef.current.startsWith(`${path}/`)) {
        const nextActive = `${newPath}${activePathRef.current.slice(path.length)}`;
        activePathRef.current = nextActive;
        setActivePath(nextActive);
      }

      toast({ tone: "success", message: `${path} moved/renamed.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Rename failed." });
      throw err;
    }
  }, [flushPendingSave, loadFiles, projectId, toast]);

  const deleteFile = useCallback(async (path: string) => {
    try {
      await flushPendingSave(path);
      await apiFetch<void>(projectFilePath(projectId, path), { method: "DELETE" });
      await loadFiles();

      const timer = saveTimersRef.current.get(path);
      if (timer) window.clearTimeout(timer);
      saveTimersRef.current.delete(path);
      tabContentsRef.current.delete(path);
      savedContentsRef.current.delete(path);
      revisionsRef.current.delete(path);
      setDirtyPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });

      // Remove deleted tabs
      const currentTabs = openTabsRef.current;
      const affectedTabs = currentTabs.filter((t) => t === path || t.startsWith(`${path}/`));
      if (affectedTabs.length > 0) {
        const nextTabs = currentTabs.filter((t) => !affectedTabs.includes(t));
        setOpenTabs(nextTabs);
        try {
          localStorage.setItem(`forge-open-tabs-${projectId}`, JSON.stringify(nextTabs));
        } catch { /* ignore */ }

        if (activePathRef.current && (activePathRef.current === path || activePathRef.current.startsWith(`${path}/`))) {
          if (nextTabs.length > 0) {
            void openFile(nextTabs[0]);
          } else {
            activePathRef.current = null;
            setActivePath(null);
            contentRef.current = "";
            setContent("");
            setSaveStatus("saved");
            try {
              localStorage.removeItem(`forge-active-tab-${projectId}`);
            } catch { /* ignore */ }
          }
        }
      }

      toast({ tone: "success", message: `${path} deleted.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Delete failed." });
      throw err;
    }
  }, [flushPendingSave, loadFiles, openFile, projectId, toast]);

  const uploadFiles = useCallback(async (entries: UploadEntry[], directories: string[] = []) => {
    if (entries.length === 0 && directories.length === 0) return;
    const formData = new FormData();
    entries.forEach(({ file, path }) => {
      formData.append("files", file, file.name);
      formData.append("paths", path);
    });
    directories.forEach((dir) => formData.append("directories", dir));
    try {
      await apiFetch<{ total: number }>(`/projects/${projectId}/files/upload`, { method: "POST", body: formData });
      await loadFiles();
      toast({ tone: "success", message: `${entries.length} file${entries.length === 1 ? "" : "s"} imported.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Import failed." });
      throw err;
    }
  }, [loadFiles, projectId, toast]);

  const handleApplyCode = useCallback((newCode: string, targetPath?: string) => {
    const fileToUpdate = targetPath || activePathRef.current;
    if (!fileToUpdate) {
      toast({ tone: "error", message: "Select a file to apply code." });
      return;
    }
    handleEditorChange(newCode);
    toast({ tone: "success", message: `Applied AI code to ${fileToUpdate}` });
  }, [handleEditorChange, toast]);

  const handleInsertCode = useCallback((codeSnippet: string) => {
    if (!activePathRef.current) {
      toast({ tone: "error", message: "Select a file to insert code." });
      return;
    }
    const current = contentRef.current;
    const separator = current.endsWith("\n") || !current ? "" : "\n";
    const updated = `${current}${separator}${codeSnippet}\n`;
    handleEditorChange(updated);
    toast({ tone: "success", message: `Inserted code into ${activePathRef.current}` });
  }, [handleEditorChange, toast]);

  const handleCreateAndApply = useCallback(async (path: string, newCode: string) => {
    try {
      await apiFetch(projectFilePath(projectId, path), { method: "PUT", body: JSON.stringify({ content: newCode }) });
      tabContentsRef.current.set(path, newCode);
      savedContentsRef.current.set(path, newCode);
      await loadFiles();
      await openFile(path);
      toast({ tone: "success", message: `Created and opened ${path}` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Failed to create file" });
    }
  }, [loadFiles, openFile, projectId, toast]);

  const gridTemplate = chatVisible ? `${widths.explorer}px minmax(0, 1fr) ${widths.chat}px` : `${widths.explorer}px minmax(0, 1fr)`;

  return (
    <div className="workspace-shell">
      <TopNavigation
        projects={projects}
        currentProject={project}
        projectsLoading={projectsLoading}
        onToggleChat={() => setChatVisible((visible) => !visible)}
        chatVisible={chatVisible}
      />
      <CommandPalette
        files={files}
        onOpenFile={openFile}
        onNewFile={() => setCreateRequest("file")}
        onNewProject={() => router.push("/projects?new=1")}
        onToggleChat={() => setChatVisible((visible) => !visible)}
      />
      <div className="workspace-toolbar">
        <div className="workspace-breadcrumb">
          <span className="breadcrumb-project">{project?.name || "Loading project"}</span>
          <Icon name="chevron-right" size={13} />
          <span>{activePath || "No file selected"}</span>
        </div>
        <div className="workspace-tools">
          <button
            onClick={() => setTerminalVisible((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors ${
              terminalVisible
                ? "bg-[#21262d] text-[#58a6ff] border-[#58a6ff]"
                : "bg-transparent text-[#8b949e] border-[#30363d] hover:text-[#e6edf3] hover:border-[#8b949e]"
            }`}
            title="Toggle Terminal (Ctrl+`)"
          >
            <Icon name="terminal" size={13} /> Terminal
          </button>
          <span className="command-hint">
            <Icon name="command" size={13} /> <kbd>⌘ / Ctrl K</kbd> Commands
          </span>
          {activePath && (
            <span className={`save-status save-status-${saveStatus}`} role="status">
              <Icon name={saveStatus === "saved" ? "check" : saveStatus === "saving" ? "refresh" : "x"} size={14} />
              {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving…" : "Unsaved changes (Ctrl+S to save)"}
            </span>
          )}
        </div>
      </div>
      <div className="workspace-body" style={{ gridTemplateColumns: gridTemplate }}>
        <aside className="workspace-panel workspace-explorer">
          <FileExplorer
            projectName={project?.name}
            rootName="main"
            files={files}
            loading={filesLoading}
            error={filesError}
            onRetry={loadFiles}
            onSelect={openFile}
            activePath={activePath}
            onCreateFile={createFile}
            onCreateFolder={createFolder}
            onRenameFile={renameFile}
            onDeleteFile={deleteFile}
            onUploadFiles={uploadFiles}
            onExplainFile={(path) => void requestFileAction(path, "explain_code")}
            onGenerateTests={(path) => void requestFileAction(path, "generate_tests")}
            createRequest={createRequest}
            onCreateRequestHandled={() => setCreateRequest(null)}
          />
          <div
            className="panel-resizer panel-resizer-right"
            onPointerDown={(event) => setDragging({ side: "explorer", startX: event.clientX, startWidth: widths.explorer })}
            role="separator"
            aria-label="Resize file explorer"
          />
        </aside>
        <section className="workspace-panel workspace-editor flex flex-col min-h-0">
          {/* Editor — shrinks when terminal is open */}
          <div className={terminalVisible ? "flex-1 min-h-0" : "h-full"}>
            <CodeEditor
              projectId={projectId}
              path={activePath}
              content={content}
              onChange={handleEditorChange}
              loading={reading}
              openTabs={openTabs}
              dirtyPaths={dirtyPaths}
              onSelectTab={openFile}
              onCloseTab={closeTab}
              onSave={handleManualSave}
            />
          </div>

          {/* Terminal panel — appears at bottom */}
          {terminalVisible && (
            <>
              {/* Drag handle to resize terminal height */}
              <div
                className="h-[4px] bg-[#30363d] cursor-row-resize hover:bg-[#58a6ff] flex-shrink-0 transition-colors"
                onPointerDown={(e) => {
                  terminalDragRef.current = { startY: e.clientY, startH: terminalHeight };
                  document.addEventListener("pointermove", onTerminalDrag);
                  document.addEventListener("pointerup", stopTerminalDrag);
                  document.body.style.cursor = "row-resize";
                  document.body.style.userSelect = "none";
                }}
              />
              <div className="flex-shrink-0" style={{ height: terminalHeight }}>
                <TerminalPanel projectId={projectId} />
              </div>
            </>
          )}
        </section>
        {chatVisible && (
          <aside className="workspace-panel workspace-chat">
            <div
              className="panel-resizer panel-resizer-left"
              onPointerDown={(event) => setDragging({ side: "chat", startX: event.clientX, startWidth: widths.chat })}
              role="separator"
              aria-label="Resize chat panel"
            />
            <div className="agent-tabs" role="tablist">
              <button
                className={panelTab === "chat" ? "agent-tab agent-tab-active" : "agent-tab"}
                type="button"
                role="tab"
                aria-selected={panelTab === "chat"}
                onClick={() => setPanelTab("chat")}
              >
                Chat
              </button>
              <button
                className={panelTab === "agent" ? "agent-tab agent-tab-active" : "agent-tab"}
                type="button"
                role="tab"
                aria-selected={panelTab === "agent"}
                onClick={() => setPanelTab("agent")}
              >
                Agent
              </button>
            </div>
            {panelTab === "chat" ? (
              <ChatPanel projectId={projectId} pendingAction={chatAction} onPendingActionHandled={() => setChatAction(null)} />
            ) : (
              <AgentPanel
                projectId={projectId}
                activePath={activePath}
                content={content}
                files={files}
                onApplyCode={handleApplyCode}
                onInsertCode={handleInsertCode}
                onCreateFile={handleCreateAndApply}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
