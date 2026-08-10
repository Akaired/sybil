// Response shapes for admin-api actions — must match supabase/functions/admin-api/index.ts.

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  plan: string;
  owner_id: string;
  created_at: string;
  suspended: boolean;
  member_count: number;
  last_activity_at: string | null;
}

export interface AdminOverviewResponse {
  workspaces: AdminWorkspaceRow[];
  totals: { llm_calls: number; web_calls: number };
}

export interface AdminUsageBucket {
  key: string;
  calls: number;
  tokens?: number;
  bytes?: number;
  avg_latency_ms: number;
  failures: number;
}

export interface AdminUsageResponse {
  range: { from: string; to: string };
  llm: {
    by_workspace: AdminUsageBucket[];
    by_function: AdminUsageBucket[];
    by_provider: AdminUsageBucket[];
  };
  web: {
    by_workspace: AdminUsageBucket[];
    by_action: AdminUsageBucket[];
  };
}

export interface AdminErroredSentinel {
  id: string;
  workspace_id: string;
  condition_text: string;
  last_error: string | null;
  last_error_at: string | null;
}

export interface AdminHealthResponse {
  last_run_at: string | null;
  errored_sentinels: AdminErroredSentinel[];
  active_sentinel_count: number;
  oldest_next_check_at: string | null;
}

export interface AdminProvider {
  id: string;
  name: string;
  base_url: string;
  model: string;
  priority: number;
  is_active: boolean;
  max_tokens: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminProvidersListResponse {
  providers: AdminProvider[];
}

export interface AdminAuditEntry {
  id: string;
  admin_user_id: string;
  admin_display_name: string;
  admin_role: "staff" | "superadmin" | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  outcome: "ok" | "denied" | "error";
  created_at: string;
}

export interface AdminAuditListResponse {
  entries: AdminAuditEntry[];
  page: number;
  page_size: number;
  total: number;
}

export interface AdminSentinelCheckResult {
  checked: number;
  triggered: number;
  results: { sentinel_id: string; status: string; detail?: string }[];
  timestamp: string;
}

export interface AdminSecret {
  name: string;
  last4: string | null;
  updated_at: string | null;
  source: "vault" | "env";
}

export interface AdminSecretsListResponse {
  secrets: AdminSecret[];
}

export interface AdminOkResponse {
  ok: boolean;
  error?: string;
}
