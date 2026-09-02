/**
 * Thin fetch wrapper for the backend API. All frontend network calls go
 * through here so auth-header injection and error handling live in one place.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

export function apiEndpoint(path: string): string {
  return `${API_URL}/api/v1${path}`;
}

export function apiHeaders(options: HeadersInit = {}): Headers {
  const headers = new Headers(options);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isMultipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = new Headers(options.headers);
  if (!isMultipart && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const authToken = getToken();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(apiEndpoint(path), {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function projectFilePath(projectId: string, path: string) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/projects/${projectId}/files/${encodedPath}`;
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("access_token", access);
  localStorage.setItem("refresh_token", refresh);
}
