"use client";

import { createContext, useCallback, useContext, useState } from "react";
import Icon from "@/components/Icon";

type ToastTone = "success" | "error";
type ToastInput = { message: string; tone: ToastTone };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ toast: (input: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((current) => [...current.slice(-3), { ...input, id }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
            <span className="toast-icon"><Icon name={item.tone === "success" ? "check" : "x"} size={15} /></span>
            <span>{item.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(item.id)} aria-label="Dismiss notification"><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
