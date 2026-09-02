"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createProject, listProjects } from "@/services/projectService";
import type { Project } from "@/types/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const res = await listProjects();
    setProjects(res.items);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await createProject(name);
    setName("");
    refresh();
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-signal mb-6">Projects</h1>
      <form onSubmit={handleCreate} className="flex gap-2 mb-8">
        <input
          className="flex-1 bg-graphite-800 border border-graphite-600 rounded-md px-3 py-2 text-sm"
          placeholder="New project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="bg-signal text-graphite-900 rounded-md px-4 py-2 text-sm font-medium">Create</button>
      </form>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-neutral-500">No projects yet — create one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="block bg-graphite-800 border border-graphite-600 rounded-md px-4 py-3 hover:border-signal transition-colors">
                <span className="text-sm font-medium">{p.name}</span>
                {p.description && <p className="text-xs text-neutral-500 mt-1">{p.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
