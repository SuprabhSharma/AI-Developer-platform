import { apiFetch } from "@/lib/api";
import type { Project } from "@/types/api";

interface ProjectListResponse {
  items: Project[];
  total: number;
}

export const listProjects = () => apiFetch<ProjectListResponse>("/projects");

export const createProject = (name: string, description?: string) =>
  apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify({ name, description }) });
