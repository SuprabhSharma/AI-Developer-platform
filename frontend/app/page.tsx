import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-signal">AI Developer Platform</h1>
      <p className="max-w-md text-graphite-500 text-sm text-neutral-400">
        A repository-aware coding workspace foundation — projects, files, and an AI assistant, built to grow into a full coding agent.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="px-4 py-2 bg-signal text-graphite-900 rounded-md text-sm font-medium hover:bg-signal-dim transition-colors">
          Log in
        </Link>
        <Link href="/register" className="px-4 py-2 border border-graphite-600 rounded-md text-sm font-medium hover:border-signal transition-colors">
          Create account
        </Link>
      </div>
    </main>
  );
}
