export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
}

export interface FileNode {
  path: string;
  file_type: "FILE" | "DIRECTORY";
  size_bytes: number;
}

export interface ChatMessageDTO {
  id: string;
  role: string;
  content: string;
  created_at: string;
}
