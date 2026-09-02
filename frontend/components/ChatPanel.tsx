"use client";
import { useState } from "react";
import type { ChatMessageDTO } from "@/types/api";
import { apiFetch } from "@/lib/api";

export default function ChatPanel({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!input.trim()) return;
    const userMsg: ChatMessageDTO = { id: crypto.randomUUID(), role: "USER", content: input, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    const currentInput = input;
    setInput("");
    try {
      const res = await apiFetch<{ conversation_id: string; message: ChatMessageDTO }>(`/projects/${projectId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: currentInput, conversation_id: conversationId }),
      });
      setConversationId(res.conversation_id);
      setMessages((prev) => [...prev, res.message]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <p className="text-xs uppercase tracking-wide text-neutral-500 px-3 py-2">AI Assistant</p>
      <div className="flex-1 overflow-y-auto px-3 flex flex-col gap-2">
        {messages.map((m) => (
          <div key={m.id} className={`text-sm rounded-md px-3 py-2 max-w-full ${m.role === "USER" ? "bg-graphite-700 self-end" : "bg-graphite-800 border border-graphite-600"}`}>
            {m.content}
          </div>
        ))}
      </div>
      <div className="p-3 flex gap-2">
        <input
          className="flex-1 bg-graphite-800 border border-graphite-600 rounded-md px-3 py-2 text-sm"
          placeholder="Ask about this project…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={sending} className="bg-signal text-graphite-900 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50">
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
