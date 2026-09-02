"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessageDTO } from "@/types/api";
import { apiEndpoint, apiHeaders } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import Icon from "@/components/Icon";

export type FileChatAction = {
  action: "explain_code" | "generate_tests";
  path: string;
  code: string;
};

type StreamRequest = {
  message: string;
  conversation_id: string | null;
  action?: "chat" | "explain_code" | "generate_tests";
  code?: string;
  path?: string;
};

type StreamEvent = { event: string; data: { token?: string; conversation_id?: string; error?: string } };

function parseSSEBlock(block: string): StreamEvent | null {
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

export default function ChatPanel({
  projectId,
  pendingAction,
  onPendingActionHandled,
}: {
  projectId: string;
  pendingAction?: FileChatAction | null;
  onPendingActionHandled?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledActionRef = useRef<FileChatAction | null>(null);
  const { toast } = useToast();

  async function send(request: StreamRequest, displayMessage: string) {
    if (!displayMessage.trim() || sending) return;
    const userMsg: ChatMessageDTO = {
      id: crypto.randomUUID(), role: "USER", content: displayMessage, created_at: new Date().toISOString(),
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "ASSISTANT", content: "", created_at: new Date().toISOString() }]);
    setSending(true);
    setError(null);
    try {
      const response = await fetch(apiEndpoint(`/projects/${projectId}/chat/stream`), {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed with status ${response.status}`);
      }
      if (!response.body) throw new Error("The assistant returned an empty stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleBlock = (block: string) => {
        const event = parseSSEBlock(block);
        if (!event) return;
        if (event.data.conversation_id) setConversationId(event.data.conversation_id);
        if (event.event === "token" && event.data.token) {
          setMessages((prev) => prev.map((message) => message.id === assistantId
            ? { ...message, content: message.content + event.data.token }
            : message));
        }
        if (event.event === "error") throw new Error(event.data.error || "The assistant stream failed");
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        blocks.forEach(handleBlock);
        if (done) break;
      }
      if (buffer.trim()) handleBlock(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The assistant could not respond";
      setError(message);
      setMessages((prev) => prev.filter((item) => item.id !== assistantId || item.content));
      toast({ tone: "error", message: message.includes("rate limit") ? message : "Chat failed. Check the assistant and try again." });
    } finally {
      setSending(false);
    }
  }

  function sendText() {
    const currentInput = input.trim();
    if (!currentInput) return;
    setInput("");
    void send({ message: currentInput, conversation_id: conversationId, action: "chat" }, currentInput);
  }

  useEffect(() => {
    if (!pendingAction || sending || handledActionRef.current === pendingAction) return;
    handledActionRef.current = pendingAction;
    const display = `${pendingAction.action === "explain_code" ? "Explain" : "Generate tests for"} ${pendingAction.path}`;
    onPendingActionHandled?.();
    void send({
      message: display,
      conversation_id: conversationId,
      action: pendingAction.action,
      code: pendingAction.code,
      path: pendingAction.path,
    }, display);
  // The action object is intentionally consumed once when the parent changes it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, sending, conversationId, onPendingActionHandled]);

  return (
    <div className="chat-panel">
      <div className="panel-heading chat-heading"><div><p className="eyebrow">Workspace context</p><h2>Assistant</h2></div><span className="online-dot" title="Ready" /></div>
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 && !sending && <div className="chat-empty"><span className="chat-empty-icon"><Icon name="sparkle" size={21} /></span><strong>Ask about your code</strong><span>Trace a bug, explain a file, or sketch the next change.</span></div>}
        {messages.map((m) => <div key={m.id} className={`chat-message ${m.role === "USER" ? "chat-message-user" : "chat-message-assistant"}`}><span className="chat-role">{m.role === "USER" ? "You" : "Assistant"}</span><p>{m.content || (sending && m.role !== "USER" ? " " : "")}</p></div>)}
        {sending && <div className="chat-thinking"><span className="spinner spinner-small" /> Thinking</div>}
      </div>
      {error && <div className="chat-error" role="alert"><Icon name="x" size={14} /><span>{error}</span></div>}
      <div className="chat-composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendText(); } }} placeholder="Ask about this project" rows={2} aria-label="Message assistant" /><button type="button" className="send-button" onClick={sendText} disabled={sending || !input.trim()} aria-label="Send message"><Icon name="send" size={16} /></button><span className="composer-hint">Enter to send · Shift+Enter for a new line</span></div>
    </div>
  );
}
