import { apiFetch, setTokens } from "@/lib/api";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

export async function register(email: string, password: string) {
  const tokens = await apiFetch<TokenResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setTokens(tokens.access_token, tokens.refresh_token);
  return tokens;
}

export async function login(email: string, password: string) {
  const tokens = await apiFetch<TokenResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setTokens(tokens.access_token, tokens.refresh_token);
  return tokens;
}
