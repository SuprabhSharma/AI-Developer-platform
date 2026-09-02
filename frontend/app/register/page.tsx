"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { register } from "@/services/authService";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register(email, password);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-graphite-800 border border-graphite-600 rounded-lg p-6 flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-signal">Create account</h1>
        <input className="bg-graphite-700 border border-graphite-600 rounded-md px-3 py-2 text-sm" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="bg-graphite-700 border border-graphite-600 rounded-md px-3 py-2 text-sm" placeholder="Password (min 8 chars)" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button className="bg-signal text-graphite-900 rounded-md py-2 text-sm font-medium hover:bg-signal-dim transition-colors" type="submit">
          Create account
        </button>
      </form>
    </main>
  );
}
