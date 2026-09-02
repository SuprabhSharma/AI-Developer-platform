import { apiFetch, projectFilePath } from "@/lib/api";
import type { FileNode } from "@/types/api";

export const listFiles = (projectId: string) =>
  apiFetch<{ items: FileNode[] }>(`/projects/${projectId}/files`);

export const readFile = (projectId: string, path: string) =>
  apiFetch<{ content: string }>(projectFilePath(projectId, path));

export const writeFile = (projectId: string, path: string, content: string = "") =>
  apiFetch<{ path: string; content: string; size_bytes: number }>(projectFilePath(projectId, path), {
    method: "PUT",
    body: JSON.stringify({ content }),
  });

export const createFolder = (projectId: string, path: string) =>
  apiFetch<FileNode>(`/projects/${projectId}/files/folders`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });

export const renameFile = (projectId: string, oldPath: string, newPath: string) =>
  apiFetch<FileNode>(projectFilePath(projectId, oldPath), {
    method: "PATCH",
    body: JSON.stringify({ new_path: newPath }),
  });

export const deleteFile = (projectId: string, path: string) =>
  apiFetch<void>(projectFilePath(projectId, path), {
    method: "DELETE",
  });
