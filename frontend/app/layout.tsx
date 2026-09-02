import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: "AI Developer Platform",
  description: "Repository-aware AI coding workspace foundation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased"><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
