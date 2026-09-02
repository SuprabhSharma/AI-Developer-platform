"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createProject, deleteProject, listProjects } from "@/services/projectService";
import type { Project } from "@/types/api";
import TopNavigation from "@/components/TopNavigation";
import CommandPalette from "@/components/CommandPalette";
import Icon from "@/components/Icon";
import { useToast } from "@/components/ToastProvider";

function ProjectSkeleton() {
  return <div className="project-skeleton"><div className="skeleton skeleton-block" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" /></div>;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await listProjects();
      setProjects(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") inputRef.current?.focus();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || creating) return;
    setCreating(true);
    try {
      await createProject(projectName);
      setName("");
      toast({ tone: "success", message: `${projectName} is ready.` });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create project";
      setError(message);
      toast({ tone: "error", message: "Project creation failed." });
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(project: Project) {
    if (!window.confirm(`Delete ${project.name}? This removes the project and its workspace.`)) return;
    setDeletingId(project.id);
    try {
      await deleteProject(project.id);
      toast({ tone: "success", message: `${project.name} was deleted.` });
      await refresh();
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Project deletion failed." });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="app-shell">
      <TopNavigation projects={projects} />
      <CommandPalette onNewProject={() => inputRef.current?.focus()} />
      <main className="page-frame">
        <div className="page-header"><div><p className="page-kicker">Your workspaces</p><h1 className="page-title">Projects</h1><p className="page-subtitle">A quiet place to build, review, and ship.</p></div><form onSubmit={handleCreate} className="create-project-form"><input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name a new project" aria-label="New project name" maxLength={255} /><button type="submit" className="primary-button" disabled={creating || !name.trim()}><Icon name="plus" size={15} />{creating ? "Creating" : "Create"}</button></form></div>
        {loading ? <><div className="loading-status"><span className="spinner spinner-small" /> Loading projects</div><div className="project-grid" aria-busy="true"><ProjectSkeleton /><ProjectSkeleton /><ProjectSkeleton /></div></> : error ? <div className="state-card"><span className="state-card-icon state-card-icon-error"><Icon name="x" size={20} /></span><strong>Could not load projects</strong><p className="error-copy">{error}</p><button type="button" className="secondary-button" onClick={refresh}><Icon name="refresh" size={14} /> Try again</button></div> : projects.length === 0 ? <div className="state-card"><span className="state-card-icon"><Icon name="archive" size={20} /></span><strong>No projects yet</strong><p>Create your first workspace above and open it in the editor.</p><button type="button" className="secondary-button" onClick={() => inputRef.current?.focus()}><Icon name="plus" size={14} /> New project</button></div> : <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}><Link href={`/projects/${project.id}`} className="project-card-link"><span className="project-card-icon"><Icon name="archive" size={17} /></span><h2>{project.name}</h2>{project.description ? <p>{project.description}</p> : <p>Ready for your next build.</p>}<span className="project-card-meta"><Icon name="branch" size={13} /> main</span></Link><button type="button" className="project-delete" onClick={() => handleDelete(project)} disabled={deletingId === project.id} aria-label={`Delete ${project.name}`} title="Delete project"><Icon name="trash" size={15} /></button></article>)}</div>}
      </main>
    </div>
  );
}
