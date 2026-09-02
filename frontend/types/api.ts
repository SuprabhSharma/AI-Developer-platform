export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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
