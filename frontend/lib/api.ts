/**
 * Thin fetch wrapper for the backend API. All frontend network calls go
 * through here so auth-header injection and error handling live in one place.
 */
// Keep browser requests same-origin. Next.js proxies this prefix to the
// backend, avoiding CORS and localhost/127.0.0.1 address mismatches.
const API_PREFIX = "/api/backend";
let refreshPromise: Promise<boolean> | null = null;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("refresh_token");
}

export function apiEndpoint(path: string): string {
  return `${API_PREFIX}${path}`;
}

export function apiHeaders(options: HeadersInit = {}): Headers {
  const headers = new Headers(options);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = fetch(apiEndpoint("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).then(async (res) => {
      if (!res.ok) return false;
      const tokens = await res.json() as { access_token: string; refresh_token: string };
      setTokens(tokens.access_token, tokens.refresh_token);
      return true;
    }).catch(() => false).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function getValidAccessToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (typeof payload.exp === "number") {
        const expMs = payload.exp * 1000;
        // If valid for at least 30 more seconds, return current token
        if (Date.now() < expMs - 30_000) {
          return token;
        }
      }
    }
  } catch {
    // If decoding fails, attempt refresh
  }

  const refreshed = await refreshAccessToken();
  if (refreshed) {
    return getToken();
  }
  return null;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, authRetry = true): Promise<T> {
  const isMultipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = new Headers(options.headers);
  if (!isMultipart && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const authToken = getToken();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(apiEndpoint(path), {
    ...options,
    headers,
  });

  const refreshable = res.status === 401 && !["/auth/login", "/auth/register", "/auth/refresh"].includes(path);
  if (refreshable) {
    if (authRetry && await refreshAccessToken()) return apiFetch<T>(path, options, false);
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      if (window.location.pathname !== "/login") window.location.replace("/login");
    }
  }

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
