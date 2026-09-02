"use client";

import { useEffect, useState } from "react";
import TopNavigation from "@/components/TopNavigation";
import Icon from "@/components/Icon";
import { apiFetch } from "@/lib/api";

type ProviderUsage = { provider: string; requests: number; tokens: number; estimated_cost_usd: number };
type Usage = {
  total_requests: number;
  total_estimated_cost_usd: number;
  tokens_used_this_week: number;
  providers: ProviderUsage[];
};

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Usage>("/usage").then(setUsage).catch((err) => setError(err instanceof Error ? err.message : "Could not load usage"));
  }, []);

  return (
    <div className="app-shell">
      <TopNavigation />
      <main className="page-frame usage-page">
        <div className="page-header"><div><p className="page-kicker">Observability</p><h1 className="page-title">AI usage</h1><p className="page-subtitle">Track requests, token volume, and estimated spend across providers.</p></div></div>
        {error ? <div className="state-card"><span className="state-card-icon state-card-icon-error"><Icon name="x" size={20} /></span><strong>Could not load usage</strong><p className="error-copy">{error}</p></div> : !usage ? <div className="loading-status"><span className="spinner spinner-small" /> Loading usage</div> : <>
          <div className="usage-cards">
            <div className="usage-card"><span className="usage-card-icon"><Icon name="activity" size={17} /></span><span className="usage-card-label">Total requests</span><strong>{usage.total_requests.toLocaleString()}</strong></div>
            <div className="usage-card"><span className="usage-card-icon"><Icon name="dollar" size={17} /></span><span className="usage-card-label">Estimated cost</span><strong>${usage.total_estimated_cost_usd.toFixed(4)}</strong></div>
            <div className="usage-card"><span className="usage-card-icon"><Icon name="code" size={17} /></span><span className="usage-card-label">Tokens this week</span><strong>{usage.tokens_used_this_week.toLocaleString()}</strong></div>
          </div>
          <section className="usage-section"><div className="usage-section-heading"><div><p className="eyebrow">By provider</p><h2>Breakdown</h2></div></div>{usage.providers.length === 0 ? <div className="usage-empty">No AI requests yet.</div> : <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>Provider</th><th>Requests</th><th>Tokens</th><th>Estimated cost</th></tr></thead><tbody>{usage.providers.map((provider) => <tr key={provider.provider}><td><span className="provider-name"><span className="provider-dot" />{provider.provider}</span></td><td>{provider.requests.toLocaleString()}</td><td>{provider.tokens.toLocaleString()}</td><td>${provider.estimated_cost_usd.toFixed(4)}</td></tr>)}</tbody></table></div>}</section>
        </>}
      </main>
    </div>
  );
}
