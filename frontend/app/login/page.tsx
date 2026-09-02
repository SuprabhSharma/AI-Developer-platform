"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/services/authService";
import Icon from "@/components/Icon";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell"><section className="auth-card"><Link href="/" className="auth-brand"><span className="brand-mark"><Icon name="github" size={17} /></span> Forge</Link><h1>Welcome back</h1><p>Pick up where you left off.</p><form onSubmit={handleSubmit} className="auth-form"><label>Email<input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={loading}>{loading && <span className="spinner spinner-small" />}{loading ? "Signing in" : "Sign in"}</button></form><p className="auth-footer">New to Forge? <Link href="/register">Create an account</Link></p></section></main>
  );
}
