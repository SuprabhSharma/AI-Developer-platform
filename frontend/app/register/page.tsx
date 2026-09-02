"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { register } from "@/services/authService";
import Icon from "@/components/Icon";

export default function RegisterPage() {
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
      await register(email, password);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell"><section className="auth-card"><Link href="/" className="auth-brand"><span className="brand-mark"><Icon name="github" size={17} /></span> Forge</Link><h1>Create your workspace</h1><p>Keep your projects, files, and notes together.</p><form onSubmit={handleSubmit} className="auth-form"><label>Email<input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input className="field" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /><span className="field-note">Use at least 8 characters.</span></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={loading}>{loading && <span className="spinner spinner-small" />}{loading ? "Creating account" : "Create account"}</button></form><p className="auth-footer">Already have an account? <Link href="/login">Sign in</Link></p></section></main>
  );
}
