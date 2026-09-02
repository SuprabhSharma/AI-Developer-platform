import { apiFetch } from "@/lib/api";

export type PlanStatus = "DRAFT" | "APPROVED" | "EXECUTING" | "COMPLETED" | "FAILED";
export type StepStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";

export interface AgentStep {
  id: string;
  plan_id: string;
  order: number;
  tool_name: string;
  tool_input: Record<string, unknown>;
  description: string;
  status: StepStatus;
  diff_before: string | null;
  diff_after: string | null;
  approval_token: string | null;
}

export interface AgentRun {
  id: string;
  plan_id: string;
  current_step_order: number;
  status: PlanStatus;
  logs: string;
  started_at: string;
  completed_at: string | null;
}

export interface AgentPlan {
  id: string;
  project_id: string;
  user_id: string;
  task_description: string;
  status: PlanStatus;
  created_at: string;
  steps: AgentStep[];
  run: AgentRun | null;
}

export const createAgentPlan = (projectId: string, task_description: string) =>
  apiFetch<AgentPlan>(`/projects/${projectId}/agent/plan`, { method: "POST", body: JSON.stringify({ task_description }) });

export const getAgentPlan = (projectId: string, planId: string) =>
  apiFetch<AgentPlan>(`/projects/${projectId}/agent/plan/${planId}`);

export const approveAgentStep = (projectId: string, planId: string, stepId: string) =>
  apiFetch<AgentStep>(`/projects/${projectId}/agent/plan/${planId}/steps/${stepId}/approve`, { method: "POST" });

export const rejectAgentStep = (projectId: string, planId: string, stepId: string) =>
  apiFetch<AgentStep>(`/projects/${projectId}/agent/plan/${planId}/steps/${stepId}/reject`, { method: "POST" });

export const executeAgentStep = (projectId: string, planId: string, stepId: string) =>
  apiFetch<{ step: AgentStep; logs: string; result: unknown }>(`/projects/${projectId}/agent/plan/${planId}/steps/${stepId}/execute`, { method: "POST" });

export const continueAgentPlan = (projectId: string, planId: string, context: string) =>
  apiFetch<AgentPlan>(`/projects/${projectId}/agent/plan/${planId}/continue`, { method: "POST", body: JSON.stringify({ context }) });

export interface AgentDirectStreamRequest {
  prompt: string;
  active_file?: string | null;
  file_content?: string | null;
  workspace_files?: string[];
  instruction_mode?: "edit" | "generate" | "explain";
}

