import type { SVGProps } from "react";

export type IconName =
  | "archive"
  | "activity"
  | "arrow-right"
  | "branch"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "command"
  | "copy"
  | "code"
  | "dollar"
  | "file"
  | "folder"
  | "folder-open"
  | "folder-plus"
  | "github"
  | "logout"
  | "more"
  | "plus"
  | "refresh"
  | "search"
  | "send"
  | "sparkle"
  | "terminal"
  | "trash"
  | "upload"
  | "x";

const paths: Record<IconName, JSX.Element> = {
  activity: <><path d="M3 12h4l2-7 4 14 2-7h6" /></>,
  archive: <><path d="M3 7h18" /><path d="M5 7v13h14V7" /><path d="M8 11h8" /><path d="M4 3h16l1 4H3l1-4Z" /></>,
  "arrow-right": <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  branch: <><path d="M6 3v12a4 4 0 0 0 4 4h8" /><circle cx="6" cy="3" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 9a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V7" /><circle cx="16" cy="5" r="2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
  command: <><path d="M18 6a3 3 0 1 0-3-3v18a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V3a3 3 0 1 0-3 3h12Z" /></>,
  code: <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h6" /></>,
  folder: <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
  "folder-open": <><path d="M5 19h14a2 2 0 0 0 1.94-1.5l1.6-6A2 2 0 0 0 20.6 9H4.4a2 2 0 0 0-1.94 2.5l1.6 6A2 2 0 0 0 5 19Z" /><path d="M3 9V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1" /></>,
  "folder-plus": <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 10v6M9 13h6" /></>,
  github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.4S18.1 0 15 2.1a13.4 13.4 0 0 0-6 0C5.9 0 4.7.4 4.7.4A5 5 0 0 0 4.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 9 18v4" /><path d="M9 18c-4.5 2-5-2-7-2" /></>,
  logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-6" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  refresh: <><path d="M20 11a8.1 8.1 0 0 0-14.6-3L3 11" /><path d="M3 5v6h6" /><path d="M4 13a8.1 8.1 0 0 0 14.6 3L21 13" /><path d="M21 19v-6h-6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  sparkle: <><path d="m12 3-1.5 5.5L5 10l5.5 1.5L12 17l1.5-5.5L19 10l-5.5-1.5Z" /><path d="m19 17-.7 2.3L16 20l2.3.7L19 23l.7-2.3L22 20l-2.3-.7Z" /></>,
  terminal: <><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
  upload: <><path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  dollar: <><path d="M12 2v20M17 6.5C16.2 5.5 14.7 5 12.8 5 10.1 5 8 6.5 8 8.5c0 2.2 2.1 3 4.7 3.6 2.5.6 4.3 1.5 4.3 3.7 0 2.1-2.2 3.7-5 3.7-2.2 0-4-.7-5-2" /></>,
  x: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
};

export default function Icon({ name, size = 16, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
