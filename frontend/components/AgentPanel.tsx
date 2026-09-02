"use client";

import { useEffect, useRef, useState } from "react";
import { apiEndpoint, apiHeaders } from "@/lib/api";
import Icon from "@/components/Icon";
import type { FileNode } from "@/types/api";
import {
  approveAgentStep,
  continueAgentPlan,
  createAgentPlan,
  executeAgentStep,
  rejectAgentStep,
  type AgentPlan,
  type AgentStep,
} from "@/services/agentService";

interface AgentPanelProps {
  projectId: string;
  activePath?: string | null;
  content?: string;
  files?: FileNode[];
  onApplyCode?: (code: string, targetPath?: string) => void;
  onInsertCode?: (code: string) => void;
  onCreateFile?: (path: string, code: string) => Promise<void>;
}

interface AgentHistoryItem {
  id: string;
  prompt: string;
  response: string;
  targetFile: string | null;
  applied: boolean;
  timestamp: string;
}

interface CodeBlock {
  language: string;
  code: string;
}

function parseSSEBlock(block: string): { event: string; data: { token?: string; active_file?: string; error?: string } } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const regex = /```(\w+)?\r?\n([\s\S]*?)```/g;
  const blocks: CodeBlock[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || "code",
      code: match[2].trimEnd(),
    });
  }
  return blocks;
}

function getStreamingCode(text: string): { code: string; language: string } | null {
  const lastFence = text.lastIndexOf("```");
  if (lastFence === -1) return null;
  const afterFence = text.slice(lastFence + 3);
  if (afterFence.includes("```")) return null;
  const firstNewline = afterFence.indexOf("\n");
  if (firstNewline === -1) return null;
  const language = afterFence.slice(0, firstNewline).trim();
  const code = afterFence.slice(firstNewline + 1);
  return { code, language: language || "code" };
}

export default function AgentPanel({
  projectId,
  activePath,
  content,
  files = [],
  onApplyCode,
  onInsertCode,
  onCreateFile,
}: AgentPanelProps) {
  const [mode, setMode] = useState<"agent" | "planner">("agent");
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AgentHistoryItem[]>([]);
  const [appliedBlocks, setAppliedBlocks] = useState<Set<string>>(new Set());
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const responseEndRef = useRef<HTMLDivElement>(null);

  // Planner state (Phase 5 step-by-step workflow)
  const [planTask, setPlanTask] = useState("");
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLastResult, setPlanLastResult] = useState("");

  const activeLineCount = content ? content.split("\n").length : 0;
  const workspaceFilesList = files.filter((f) => f.file_type === "FILE").map((f) => f.path);

  useEffect(() => {
    if (streaming && responseEndRef.current) {
      responseEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streaming, currentResponse]);

  async function handleSend() {
    const text = prompt.trim();
    if (!text || streaming) return;

    setStreaming(true);
    setError(null);
    setCurrentResponse("");
    const targetFile = activePath || null;
    let accumulatedText = "";

    try {
      const response = await fetch(apiEndpoint(`/projects/${projectId}/agent/stream`), {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          prompt: text,
          active_file: targetFile,
          file_content: content || "",
          workspace_files: workspaceFilesList,
          instruction_mode: "edit",
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Agent request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("No response body received from agent");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const parsed = parseSSEBlock(block);
          if (!parsed) continue;
          if (parsed.event === "token" && parsed.data.token) {
            accumulatedText += parsed.data.token;
            setCurrentResponse(accumulatedText);
          }
          if (parsed.event === "error") {
            throw new Error(parsed.data.error || "Streaming error");
          }
        }
        if (done) break;
      }

      if (buffer.trim()) {
        const parsed = parseSSEBlock(buffer);
        if (parsed?.event === "token" && parsed.data.token) {
          accumulatedText += parsed.data.token;
          setCurrentResponse(accumulatedText);
        }
      }

      // Add to session history
      if (accumulatedText.trim()) {
        const newItem: AgentHistoryItem = {
          id: crypto.randomUUID(),
          prompt: text,
          response: accumulatedText,
          targetFile,
          applied: false,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setHistory((prev) => [newItem, ...prev]);
        setPrompt("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent encountered an error.");
    } finally {
      setStreaming(false);
    }
  }

  function handleApply(code: string, blockKey: string, target?: string | null) {
    const destination = target || activePath;
    if (!destination) {
      setError("No file is currently selected to apply this code to.");
      return;
    }
    onApplyCode?.(code, destination);
    setAppliedBlocks((prev) => new Set(prev).add(blockKey));
    setTimeout(() => {
      setAppliedBlocks((prev) => {
        const next = new Set(prev);
        next.delete(blockKey);
        return next;
      });
    }, 4000);
  }

  function handleInsert(code: string) {
    onInsertCode?.(code);
  }

  function handleCopy(code: string, blockKey: string) {
    void navigator.clipboard.writeText(code);
    setCopiedIndex(blockKey);
    setTimeout(() => setCopiedIndex(null), 2500);
  }

  function handleQuickPrompt(template: string) {
    const fileRef = activePath ? `in ${activePath}` : "in this workspace";
    setPrompt(`${template} ${fileRef}: `);
  }

  // Planner methods (legacy Phase 5 flow fallback)
  async function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    if (!planTask.trim() || planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      setPlan(await createAgentPlan(projectId, planTask.trim()));
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Could not create a plan.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function updatePlanStep(step: AgentStep, action: "approve" | "reject" | "execute") {
    if (!plan || planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const result =
        action === "approve"
          ? await approveAgentStep(projectId, plan.id, step.id)
          : action === "reject"
          ? await rejectAgentStep(projectId, plan.id, step.id)
          : await executeAgentStep(projectId, plan.id, step.id);

      const updated = "step" in result ? result.step : result;
      if (action === "execute") setPlanLastResult("result" in result ? JSON.stringify(result.result) : "");

      setPlan((current) => {
        if (!current) return current;
        const nextSteps = current.steps.map((item) => (item.id === step.id ? updated : item));
        const complete = nextSteps.every((item) => item.status === "EXECUTED" || item.status === "REJECTED");
        const status: AgentPlan["status"] =
          action === "approve" ? "APPROVED" : action === "execute" ? (complete ? "COMPLETED" : "EXECUTING") : current.status;
        return {
          ...current,
          steps: nextSteps,
          status,
          run: current.run
            ? { ...current.run, status, logs: "logs" in result ? result.logs : current.run.logs }
            : current.run,
        };
      });
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Agent action failed.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function continuePlanning() {
    if (!plan || planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const approvedStep = plan.steps.find((step) => step.status === "APPROVED");
      if (approvedStep) {
        const result = await executeAgentStep(projectId, plan.id, approvedStep.id);
        const updated = result.step;
        const nextSteps = plan.steps.map((step) => (step.id === updated.id ? updated : step));
        const complete = nextSteps.every((step) => step.status === "EXECUTED" || step.status === "REJECTED");
        setPlanLastResult(JSON.stringify(result.result));
        if (complete) {
          setPlan(await continueAgentPlan(projectId, plan.id, JSON.stringify(result.result)));
        } else {
          setPlan({
            ...plan,
            steps: nextSteps,
            status: "EXECUTING",
            run: plan.run ? { ...plan.run, status: "EXECUTING", logs: result.logs } : plan.run,
          });
        }
      } else {
        setPlan(await continueAgentPlan(projectId, plan.id, planLastResult));
      }
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Could not continue the plan.");
    } finally {
      setPlanBusy(false);
    }
  }

  const currentBlocks = extractCodeBlocks(currentResponse);
  const streamingPartial = streaming ? getStreamingCode(currentResponse) : null;

  return (
    <div className="agent-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Top Heading with Mode Selector */}
      <div className="panel-heading" style={{ minHeight: "56px", padding: "10px 14px" }}>
        <div>
          <p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
            <span>VS Code Coding Agent</span>
            <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "3px", background: "rgba(56, 139, 253, 0.15)", color: "var(--blue)" }}>
              Groq AI
            </span>
          </p>
          <h2 style={{ fontSize: "13px", marginTop: "2px", fontWeight: 600 }}>
            {mode === "agent" ? "Code Assistant" : "Step Planner"}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            className={mode === "agent" ? "primary-button" : "secondary-button"}
            style={{ padding: "4px 8px", fontSize: "11px", height: "26px" }}
            onClick={() => setMode("agent")}
          >
            Code
          </button>
          <button
            type="button"
            className={mode === "planner" ? "primary-button" : "secondary-button"}
            style={{ padding: "4px 8px", fontSize: "11px", height: "26px" }}
            onClick={() => setMode("planner")}
          >
            Plan
          </button>
        </div>
      </div>

      {mode === "agent" ? (
        <>
          {/* Active Context Window Bar */}
          <div
            style={{
              padding: "7px 12px",
              background: "var(--surface-raised)",
              borderBottom: "1px solid var(--line)",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
              <Icon name="file" size={13} />
              {activePath ? (
                <span style={{ color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activePath}
                  <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: "5px" }}>({activeLineCount} lines)</span>
                </span>
              ) : (
                <span style={{ color: "var(--muted)", fontStyle: "italic" }}>No file open (select in explorer)</span>
              )}
            </div>
            <span style={{ color: "var(--faint)", fontSize: "10px", flexShrink: 0 }}>
              {workspaceFilesList.length} files
            </span>
          </div>

          {/* Quick Action Prompt Chips */}
          <div
            style={{
              display: "flex",
              gap: "5px",
              padding: "6px 12px",
              overflowX: "auto",
              borderBottom: "1px solid var(--line)",
              background: "var(--surface)",
              flexShrink: 0,
            }}
          >
            {[
              { label: "✨ Add Feature", text: "Add feature to" },
              { label: "🐛 Fix Bug", text: "Debug and fix issues in" },
              { label: "⚡ Optimize", text: "Refactor and optimize" },
              { label: "📝 Add Types", text: "Add comprehensive TypeScript types to" },
              { label: "🧪 Tests", text: "Write unit tests for" },
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleQuickPrompt(chip.text)}
                style={{
                  whiteSpace: "nowrap",
                  padding: "3px 7px",
                  borderRadius: "4px",
                  border: "1px solid var(--line)",
                  background: "var(--surface-raised)",
                  color: "var(--muted)",
                  fontSize: "10px",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--blue)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--line)";
                  e.currentTarget.style.color = "var(--muted)";
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Messages / Output Stream Container */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "14px" }}>
            {history.length === 0 && !streaming && !currentResponse && (
              <div className="panel-state" style={{ padding: "30px 10px", margin: "auto 0" }}>
                <span className="chat-empty-icon" style={{ width: "36px", height: "36px", marginBottom: "8px" }}>
                  <Icon name="code" size={18} />
                </span>
                <strong style={{ fontSize: "13px" }}>Ready to code</strong>
                <p style={{ margin: "4px 0", maxWidth: "260px", color: "var(--muted)", fontSize: "11px", lineHeight: "1.4" }}>
                  {activePath
                    ? `Instruct the agent to write, refactor, or edit code in ${activePath}. One-click apply changes directly to Monaco editor.`
                    : "Open a file in the workspace or prompt to create a new file."}
                </p>
              </div>
            )}

            {/* In-flight streaming response */}
            {(streaming || (currentResponse && history[0]?.response !== currentResponse)) && (
              <div
                style={{
                  border: "1px solid var(--blue)",
                  borderRadius: "8px",
                  background: "rgba(56, 139, 253, 0.04)",
                  padding: "10px 12px",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "11px", color: "var(--blue)", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span className="spinner spinner-small" />
                    {streaming ? "Generating code..." : "Output"}
                  </span>
                  {activePath && (
                    <span style={{ fontSize: "10px", color: "var(--muted)" }}>Target: {activePath}</span>
                  )}
                </div>

                {/* Explanation text */}
                <div
                  style={{
                    fontSize: "12px",
                    lineHeight: "1.5",
                    whiteSpace: "pre-wrap",
                    color: "var(--ink)",
                    marginBottom: "10px",
                  }}
                >
                  {currentResponse.replace(/```(\w+)?[\s\S]*?```/g, "").trim()}
                </div>

                {/* Completed code blocks */}
                {currentBlocks.map((block, idx) => {
                  const key = `active-block-${idx}`;
                  const isApplied = appliedBlocks.has(key);
                  return (
                    <div
                      key={key}
                      style={{
                        margin: "8px 0",
                        border: "1px solid var(--line-strong)",
                        borderRadius: "6px",
                        overflow: "hidden",
                        background: "var(--canvas)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          background: "var(--surface-hover)",
                          borderBottom: "1px solid var(--line)",
                          fontSize: "11px",
                        }}
                      >
                        <span style={{ color: "var(--muted)", textTransform: "uppercase", fontSize: "10px", fontWeight: 600 }}>
                          {block.language}
                        </span>
                        <div style={{ display: "flex", gap: "5px" }}>
                          <button
                            type="button"
                            onClick={() => handleCopy(block.code, key)}
                            style={{
                              padding: "3px 7px",
                              borderRadius: "4px",
                              border: "1px solid var(--line)",
                              background: "var(--surface-raised)",
                              color: "var(--ink)",
                              fontSize: "10px",
                              cursor: "pointer",
                            }}
                          >
                            {copiedIndex === key ? "✓ Copied" : "Copy"}
                          </button>
                          {onInsertCode && (
                            <button
                              type="button"
                              onClick={() => handleInsert(block.code)}
                              style={{
                                padding: "3px 7px",
                                borderRadius: "4px",
                                border: "1px solid var(--line)",
                                background: "var(--surface-raised)",
                                color: "var(--ink)",
                                fontSize: "10px",
                                cursor: "pointer",
                              }}
                            >
                              Insert
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleApply(block.code, key, activePath)}
                            style={{
                              padding: "3px 9px",
                              borderRadius: "4px",
                              border: "0",
                              background: isApplied ? "var(--green)" : "var(--blue)",
                              color: "#fff",
                              fontSize: "11px",
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            {isApplied ? "✓ Applied to Editor" : "✨ Apply to Editor"}
                          </button>
                        </div>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: "10px",
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          overflowX: "auto",
                          maxHeight: "260px",
                          color: "var(--ink)",
                          lineHeight: "1.45",
                        }}
                      >
                        <code>{block.code}</code>
                      </pre>
                    </div>
                  );
                })}

                {/* Partial streaming code preview */}
                {streamingPartial && (
                  <div
                    style={{
                      margin: "8px 0",
                      border: "1px dashed var(--blue)",
                      borderRadius: "6px",
                      overflow: "hidden",
                      background: "var(--canvas)",
                    }}
                  >
                    <div
                      style={{
                        padding: "4px 8px",
                        background: "rgba(56, 139, 253, 0.1)",
                        fontSize: "10px",
                        color: "var(--blue)",
                        fontWeight: 600,
                      }}
                    >
                      Writing {streamingPartial.language}...
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: "10px",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        overflowX: "auto",
                        maxHeight: "180px",
                        color: "var(--ink)",
                        lineHeight: "1.45",
                        opacity: 0.9,
                      }}
                    >
                      <code>{streamingPartial.code}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Previous turns history */}
            {history.map((item) => {
              const blocks = extractCodeBlocks(item.response);
              const textOnly = item.response.replace(/```(\w+)?[\s\S]*?```/g, "").trim();

              return (
                <div
                  key={item.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: "8px",
                    background: "var(--surface-raised)",
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "6px",
                      borderBottom: "1px solid var(--line)",
                      paddingBottom: "6px",
                    }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--blue)" }}>
                      You: {item.prompt}
                    </span>
                    <span style={{ fontSize: "9px", color: "var(--faint)" }}>{item.timestamp}</span>
                  </div>

                  {textOnly && (
                    <div
                      style={{
                        fontSize: "12px",
                        lineHeight: "1.45",
                        color: "var(--ink)",
                        whiteSpace: "pre-wrap",
                        marginBottom: "8px",
                      }}
                    >
                      {textOnly}
                    </div>
                  )}

                  {blocks.map((block, bIdx) => {
                    const blockKey = `${item.id}-${bIdx}`;
                    const isApplied = appliedBlocks.has(blockKey);

                    return (
                      <div
                        key={blockKey}
                        style={{
                          margin: "6px 0",
                          border: "1px solid var(--line-strong)",
                          borderRadius: "5px",
                          overflow: "hidden",
                          background: "var(--canvas)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "5px 8px",
                            background: "var(--surface-hover)",
                            borderBottom: "1px solid var(--line)",
                            fontSize: "10px",
                          }}
                        >
                          <span style={{ color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>
                            {block.language} {item.targetFile ? `· ${item.targetFile}` : ""}
                          </span>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              type="button"
                              onClick={() => handleCopy(block.code, blockKey)}
                              style={{
                                padding: "2px 6px",
                                borderRadius: "3px",
                                border: "1px solid var(--line)",
                                background: "var(--surface-raised)",
                                color: "var(--ink)",
                                fontSize: "10px",
                                cursor: "pointer",
                              }}
                            >
                              {copiedIndex === blockKey ? "✓" : "Copy"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApply(block.code, blockKey, item.targetFile)}
                              style={{
                                padding: "2px 8px",
                                borderRadius: "3px",
                                border: "0",
                                background: isApplied ? "var(--green)" : "var(--blue)",
                                color: "#fff",
                                fontSize: "10px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {isApplied ? "✓ Applied" : "✨ Apply"}
                            </button>
                          </div>
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            padding: "8px",
                            fontSize: "11px",
                            fontFamily: "var(--font-mono)",
                            overflowX: "auto",
                            maxHeight: "220px",
                            color: "var(--ink)",
                            lineHeight: "1.4",
                          }}
                        >
                          <code>{block.code}</code>
                        </pre>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div ref={responseEndRef} />
          </div>

          {error && (
            <div className="chat-error" style={{ margin: "0 10px 8px" }} role="alert">
              <Icon name="x" size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Composer Box */}
          <div
            style={{
              padding: "10px 12px 14px",
              borderTop: "1px solid var(--line)",
              background: "var(--surface)",
              position: "relative",
            }}
          >
            <div style={{ position: "relative" }}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  activePath
                    ? `Describe changes for ${activePath} (e.g. 'Add validation logic')...`
                    : "Describe code to write or generate..."
                }
                rows={2}
                disabled={streaming}
                style={{
                  width: "100%",
                  resize: "none",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  outline: "0",
                  color: "var(--ink)",
                  background: "var(--canvas)",
                  padding: "8px 36px 8px 9px",
                  fontSize: "12px",
                  lineHeight: "1.4",
                }}
              />
              <button
                type="button"
                className="send-button"
                onClick={() => void handleSend()}
                disabled={streaming || !prompt.trim()}
                title="Generate code (Enter)"
                style={{ position: "absolute", right: "7px", top: "7px" }}
              >
                {streaming ? <span className="spinner spinner-small" /> : <Icon name="send" size={15} />}
              </button>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "5px",
                fontSize: "10px",
                color: "var(--faint)",
              }}
            >
              <span>Enter to run · Shift+Enter for newline</span>
              {activePath && (
                <span style={{ color: "var(--muted)" }}>
                  Editing: <strong>{activePath.split("/").pop()}</strong>
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Legacy Phase 5 Step Planner Tab */
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <form className="agent-composer" onSubmit={submitPlan}>
            <textarea
              value={planTask}
              onChange={(e) => setPlanTask(e.target.value)}
              placeholder="Describe a multi-step task (e.g. 'Audit imports and update types')..."
              rows={3}
              aria-label="Agent task"
            />
            <button className="primary-button" type="submit" disabled={planBusy || !planTask.trim()}>
              {planBusy ? "Planning…" : "Create multi-step plan"}
            </button>
          </form>

          {planError && (
            <p className="agent-error" role="alert">
              {planError}
            </p>
          )}

          {plan && (
            <div className="agent-plan">
              <div className="agent-plan-meta">
                <span>{plan.status}</span>
                <span>
                  {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}
                </span>
              </div>
              {plan.steps.map((step) => (
                <article className="agent-step" key={step.id}>
                  <div className="agent-step-heading">
                    <span className="agent-step-number">{step.order}</span>
                    <div>
                      <strong>{step.description || step.tool_name}</strong>
                      <small>{step.tool_name}</small>
                    </div>
                    <span className={`agent-status agent-status-${step.status.toLowerCase()}`}>{step.status}</span>
                  </div>
                  {(step.tool_name === "write_file" || step.tool_name === "edit_file") && (
                    <div className="agent-diff">
                      <div>
                        <small>Before</small>
                        <pre>{step.diff_before ?? "Pending approval"}</pre>
                      </div>
                      <div>
                        <small>After</small>
                        <pre>{step.diff_after ?? "Pending approval"}</pre>
                      </div>
                    </div>
                  )}
                  <div className="agent-step-actions">
                    {step.status === "PENDING" && (
                      <>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={planBusy}
                          onClick={() => void updatePlanStep(step, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={planBusy}
                          onClick={() => void updatePlanStep(step, "reject")}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {step.status === "APPROVED" && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={planBusy}
                        onClick={() => void continuePlanning()}
                      >
                        Continue agent
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {plan.status === "COMPLETED" && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={planBusy}
                  onClick={() => void continuePlanning()}
                >
                  Plan next step
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
