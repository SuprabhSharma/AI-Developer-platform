import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Developer Platform",
  description: "Repository-aware AI coding workspace foundation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono antialiased">{children}</body>
    </html>
  );
}
