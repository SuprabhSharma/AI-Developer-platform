"use client";
import dynamic from "next/dynamic";

const Inner = dynamic(() => import("./TerminalPanelInner"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#0d1117] text-[#8b949e] text-sm gap-2">
      <span className="spinner spinner-small" /> Loading terminal...
    </div>
  ),
});

export default function TerminalPanel({ projectId }: { projectId: string }) {
  return <Inner projectId={projectId} />;
}
