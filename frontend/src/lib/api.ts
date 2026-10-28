import { supabase } from "./supabase";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

type AuthResolution =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: "NO_SESSION" | "REFRESH_FAILED"; detail?: string };

async function resolveAuth(): Promise<AuthResolution> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { ok: false, reason: "NO_SESSION" };
    }

    // If the token is expired or expiring within 60s, force a refresh before
    // sending it to the backend — prevents the backend from seeing a stale JWT
    // that it would correctly reject with 401 (e.g. after an idle overnight tab).
    const expiresAt = session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt < nowSec + 60) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshed.session?.access_token) {
        return { ok: false, reason: "REFRESH_FAILED", detail: refreshErr?.message };
      }
      return { ok: true, headers: { Authorization: `Bearer ${refreshed.session.access_token}` } };
    }

    return { ok: true, headers: { Authorization: `Bearer ${session.access_token}` } };
  } catch (err) {
    console.warn(
      "[API Auth] Supabase session refresh failed — clearing stale local auth state.",
      err,
    );
    if (typeof document !== "undefined") {
      document.cookie = "zv_auth=; path=/; SameSite=Strict; max-age=0";
    }
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("zv_role_cache");
      } catch {}
    }
    return {
      ok: false,
      reason: "REFRESH_FAILED",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function authExpiredResponse(reason: "NO_SESSION" | "REFRESH_FAILED") {
  const message =
    reason === "REFRESH_FAILED"
      ? "Your session has expired. Please log in again."
      : "You are signed out. Please log in to continue.";
  return {
    success: false,
    error: message,
    status: 401,
    code: "AUTH_EXPIRED",
    data: { error: { code: "AUTH_EXPIRED", message } },
  };
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.error(
      `[API Network Error] Failed to connect to backend at ${url}. Ensure the server is running.`,
      err,
    );
    throw new Error(
      "Connection to backend failed. Please ensure the backend server is running and accessible.",
    );
  }
}

async function apiError(response: Response, endpoint: string, method: string) {
  const errorData = await response.json().catch(() => ({}));
  const errorMessage =
    typeof errorData.error === "object"
      ? errorData.error.message
      : errorData.error ||
        errorData.message ||
        errorData.detail ||
        response.statusText ||
        `${method} ${endpoint} failed`;
  return {
    success: false,
    error: errorMessage,
    status: response.status,
    data: errorData,
  };
}

export const api = {
  async get(endpoint: string, options?: { signal?: AbortSignal }) {
    const auth = await resolveAuth();
    if (!auth.ok) return authExpiredResponse(auth.reason);
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      headers: { ...auth.headers },
      signal: options?.signal,
    });
    if (!response.ok) {
      return apiError(response, endpoint, "GET");
    }
    return response.json();
  },

  async post(endpoint: string, body: any, options?: { signal?: AbortSignal }) {
    const auth = await resolveAuth();
    if (!auth.ok) return authExpiredResponse(auth.reason);
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...auth.headers,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!response.ok) {
      return apiError(response, endpoint, "POST");
    }
    return response.json();
  },

  async getBlob(endpoint: string): Promise<Blob> {
    const auth = await resolveAuth();
    if (!auth.ok) throw new Error(auth.reason === "NO_SESSION" ? "No session" : "Session expired");
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      headers: { ...auth.headers },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`GET ${endpoint} failed: ${response.status} ${text}`);
    }
    return response.blob();
  },

  async postBlob(endpoint: string, body: unknown): Promise<Blob> {
    const auth = await resolveAuth();
    if (!auth.ok) throw new Error(auth.reason === "NO_SESSION" ? "No session" : "Session expired");
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...auth.headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`POST ${endpoint} failed: ${response.status} ${text}`);
    }
    return response.blob();
  },

  async postMultipart(endpoint: string, formData: FormData) {
    const auth = await resolveAuth();
    if (!auth.ok) return authExpiredResponse(auth.reason);
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers: { ...auth.headers },
      body: formData,
    });
    if (!response.ok) {
      return apiError(response, endpoint, "POST (Multipart)");
    }
    return response.json();
  },

  async put(endpoint: string, body: any) {
    const auth = await resolveAuth();
    if (!auth.ok) return authExpiredResponse(auth.reason);
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...auth.headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return apiError(response, endpoint, "PUT");
    }
    return response.json();
  },

  async delete(endpoint: string) {
    const auth = await resolveAuth();
    if (!auth.ok) return authExpiredResponse(auth.reason);
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      method: "DELETE",
      headers: { ...auth.headers },
    });
    if (!response.ok) {
      return apiError(response, endpoint, "DELETE");
    }
    return response.json();
  },

  async patch(endpoint: string, body: any) {
    const auth = await resolveAuth();
    if (!auth.ok) return authExpiredResponse(auth.reason);
    const response = await safeFetch(`${BACKEND_URL}${endpoint}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...auth.headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return apiError(response, endpoint, "PATCH");
    }
    return response.json();
  },

  // Operations API
  async getOperationsStats() {
    return this.get("/api/v1/operations/stats");
  },

  async listAgentRuns(params?: {
    status?: string;
    severity?: string;
    environment?: string;
    brand?: string;
    brand_id?: string;
    search?: string;
    sort_by?: string;
    sort_dir?: string;
    limit?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.severity) query.set("severity", params.severity);
    if (params?.environment) query.set("environment", params.environment);
    if (params?.brand) query.set("brand", params.brand);
    if (params?.brand_id) query.set("brand_id", params.brand_id);
    if (params?.search) query.set("search", params.search);
    if (params?.sort_by) query.set("sort_by", params.sort_by);
    if (params?.sort_dir) query.set("sort_dir", params.sort_dir);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    return this.get(`/api/v1/operations/runs?${query.toString()}`);
  },

  async getAgentRun(id: string) {
    return this.get(`/api/v1/operations/runs/${id}`);
  },

  async getRunTimeline(id: string) {
    return this.get(`/api/v1/operations/runs/${id}/timeline`);
  },

  async pauseRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/pause`, { reason });
  },

  async resumeRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/resume`, { reason });
  },

  async startRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/start`, { reason });
  },

  async deleteRun(id: string) {
    return this.delete(`/api/v1/operations/runs/${id}`);
  },

  async stopRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/stop`, { reason });
  },

  async retryRun(id: string, reason?: string, scope?: string) {
    return this.post(`/api/v1/operations/runs/${id}/retry`, { reason, scope });
  },

  async quarantineRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/quarantine`, { reason });
  },

  async listQueues(params?: { queue_type?: string; status?: string; environment?: string; brand?: string; brand_id?: string }) {
    const query = new URLSearchParams();
    if (params?.queue_type) query.set("queue_type", params.queue_type);
    if (params?.status) query.set("status", params.status);
    if (params?.environment) query.set("environment", params.environment);
    if (params?.brand) query.set("brand", params.brand);
    if (params?.brand_id) query.set("brand_id", params.brand_id);
    return this.get(`/api/v1/operations/queues?${query.toString()}`);
  },

  async assignQueueItem(id: string, assignee_id?: string, assignee_name?: string) {
    return this.post(`/api/v1/operations/queues/${id}/assign`, {
      assignee_id,
      assignee_name,
    });
  },

  async resolveQueueItem(id: string, resolution_notes?: string) {
    return this.post(`/api/v1/operations/queues/${id}/resolve`, resolution_notes ? { resolution_notes } : {});
  },

  async createIncident(data: {
    run_id?: string;
    severity: string;
    category: string;
    root_cause?: string;
    due_at?: string;
    remediation?: string;
  }) {
    return this.post("/api/v1/operations/incidents", data);
  },

  async listIncidents(params?: { severity?: string; status?: string; environment?: string; brand?: string; brand_id?: string }) {
    const query = new URLSearchParams();
    if (params?.severity) query.set("severity", params.severity);
    if (params?.status) query.set("status", params.status);
    if (params?.environment) query.set("environment", params.environment);
    if (params?.brand) query.set("brand", params.brand);
    if (params?.brand_id) query.set("brand_id", params.brand_id);
    return this.get(`/api/v1/operations/incidents?${query.toString()}`);
  },

  async resolveIncident(id: string, resolution?: string, remediation?: string) {
    return this.patch(`/api/v1/operations/incidents/${id}/resolve`, {
      resolution,
      remediation,
    });
  },

  async getRunEvidence(bundleId: string) {
    return this.get(`/api/v1/operations/evidence/${bundleId}`);
  },

  async exportEvidence(bundleId: string, reason?: string) {
    return this.post(`/api/v1/operations/evidence/${bundleId}/export`, {
      reason,
    });
  },

  async getRunDetail(id: string) {
    return this.get(`/api/v1/operations/runs/${id}`);
  },

  async getOperationsAnalytics(params?: {
    time_range?: string;
    metric?: string;
    environment?: string;
    brand?: string;
    brand_id?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.time_range) query.set("time_range", params.time_range);
    if (params?.metric) query.set("metric", params.metric);
    if (params?.environment) query.set("environment", params.environment);
    if (params?.brand) query.set("brand", params.brand);
    if (params?.brand_id) query.set("brand_id", params.brand_id);
    return this.get(`/api/v1/operations/analytics?${query.toString()}`);
  },

  async getOperationsStatsScoped(params?: { environment?: string; brand?: string; brand_id?: string }) {
    const query = new URLSearchParams();
    if (params?.environment) query.set("environment", params.environment);
    if (params?.brand) query.set("brand", params.brand);
    if (params?.brand_id) query.set("brand_id", params.brand_id);
    return this.get(`/api/v1/operations/stats?${query.toString()}`);
  },

  async emergencyPause(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/emergency-pause`, {
      reason,
    });
  },

  async escalateRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/escalate`, { reason });
  },

  async restrictedMode(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/restricted-mode`, { reason });
  },

  async holdRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/hold`, { reason });
  },

  async releaseHoldRun(id: string, reason?: string) {
    return this.post(`/api/v1/operations/runs/${id}/release-hold`, { reason });
  },

  // Returns CSV Blob for client-side download.
  async exportAnalyticsCSV(reason: string): Promise<Blob> {
    return this.postBlob("/api/v1/operations/analytics/export", { reason });
  },

  async exportOutputSnapshot(id: string, reason: string) {
    return this.post(`/api/v1/operations/runs/${id}/export-output`, { reason });
  },

  async runPolicyCheck(id: string) {
    return this.post(`/api/v1/operations/runs/${id}/policy-check`, {});
  },

  async generatePostmortem(incidentId: string) {
    return this.post(`/api/v1/operations/incidents/${incidentId}/postmortem`, {});
  },

  async getPostmortem(incidentId: string) {
    return this.get(`/api/v1/operations/incidents/${incidentId}/postmortem`);
  },

  async getPolicyResults(id: string) {
    return this.get(`/api/v1/operations/runs/${id}/policy-results`);
  },

  async getRuntimeControlLog(id: string) {
    return this.get(`/api/v1/operations/runs/${id}/control-log`);
  },

  // ─── AGENTS API CLIENT ───
  async listAgents(params?: {
    workspaceId?: string;
    status?: string;
    risk?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.workspaceId) query.set("workspaceId", params.workspaceId);
    if (params?.status) query.set("status", params.status);
    if (params?.risk) query.set("risk", params.risk);
    return this.get(`/api/v1/agents?${query.toString()}`);
  },

  async getAgent(id: string) {
    return this.get(`/api/v1/agents/${id}`);
  },

  async registerAgent(data: any) {
    return this.post("/api/v1/agents", data);
  },

  async certifyAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/certify`, {});
  },

  async runAgentSandbox(id: string, targetLevel: string, riskLevel?: string) {
    return this.post(`/api/v1/agents/${id}/sandbox`, {
      target_level: targetLevel,
      risk_level: riskLevel,
    });
  },

  async getAgentSandboxHistory(id: string) {
    return this.get(`/api/v1/agents/${id}/sandbox/history`);
  },

  async updateAgentAutonomy(id: string, level: string, reason?: string) {
    return this.patch(`/api/v1/agents/${id}/autonomy`, { level, reason });
  },

  async deployAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/deploy`, {});
  },

  async pauseAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/pause`, {});
  },

  async resumeAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/resume`, {});
  },

  async retireAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/retire`, {});
  },

  async cloneAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/clone`, {});
  },

  async requestAgentApproval(id: string) {
    return this.post(`/api/v1/agents/${id}/approval/request`, {});
  },

  async approveAgent(id: string) {
    return this.post(`/api/v1/agents/${id}/approval/approve`, {});
  },

  async rejectAgentApproval(id: string) {
    return this.post(`/api/v1/agents/${id}/approval/reject`, {});
  },

  async updateAgentRuntime(id: string, data: any) {
    return this.patch(`/api/v1/agents/${id}/runtime`, data);
  },

  // ─── WORKFLOWS API CLIENT ───
  async listWorkflows() {
    return this.get("/api/v1/agents/workflows");
  },

  async getWorkflowStats() {
    return this.get("/api/v1/agents/workflows/stats");
  },

  async getWorkflowControlStrip() {
    return this.get("/api/v1/agents/workflows/control-strip");
  },

  async getWorkflowAnalytics() {
    return this.get("/api/v1/agents/workflows/analytics");
  },

  async getActiveOrchestrations() {
    return this.get("/api/v1/agents/workflows/active");
  },

  async getWorkflowGraphGeneral() {
    return this.get("/api/v1/agents/workflows/graph");
  },

  async getEscalationPaths() {
    return this.get("/api/v1/agents/workflows/escalations");
  },

  async getWorkflowApprovals() {
    return this.get("/api/v1/agents/workflows/approvals");
  },

  async getWorkflowApprovalStats() {
    return this.get("/api/v1/agents/workflows/approvals/stats");
  },

  async createWorkflow(data: any) {
    return this.post("/api/v1/agents/workflows", data);
  },

  async getWorkflow(id: string) {
    return this.get(`/api/v1/agents/workflows/${id}`);
  },

  async updateWorkflow(id: string, data: any) {
    return this.patch(`/api/v1/agents/workflows/${id}`, data);
  },

  async deleteWorkflow(id: string) {
    return this.delete(`/api/v1/agents/workflows/${id}`);
  },

  async duplicateWorkflow(id: string) {
    return this.post(`/api/v1/agents/workflows/${id}/duplicate`, {});
  },

  async listWorkflowVersions(id: string) {
    return this.get(`/api/v1/agents/workflows/${id}/versions`);
  },

  async createWorkflowDraftVersion(id: string, data: any) {
    return this.post(`/api/v1/agents/workflows/${id}/versions`, data);
  },

 async simulateWorkflowVersion(versionId: string, scenarioName?: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/simulate`,
      { scenario_name: scenarioName || 'default' },
    );
  },

  async submitWorkflowForApproval(versionId: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/submit`,
      {},
    );
  },

  async approveWorkflowVersion(versionId: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/approve`,
      {},
    );
  },

  async rejectWorkflowVersion(versionId: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/reject`,
      {},
    );
  },

  async activateWorkflowVersion(versionId: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/activate`,
      {},
    );
  },

  async pauseWorkflow(versionId: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/pause`,
      {},
    );
  },

  async retireWorkflow(versionId: string) {
    return this.post(
      `/api/v1/agents/workflows/versions/${versionId}/retire`,
      {},
    );
  },

  async startWorkflowInstance(data: any) {
    return this.post("/api/v1/agents/workflows/instances", data);
  },

  async listWorkflowInstances() {
    return this.get("/api/v1/agents/workflows/instances");
  },

  async getWorkflowInstance(instanceId: string) {
    return this.get(`/api/v1/agents/workflows/instances/${instanceId}`);
  },

  async transitionWorkflowInstance(instanceId: string, data: any) {
    return this.patch(
      `/api/v1/agents/workflows/instances/${instanceId}/transition`,
      data,
    );
  },
  async getWorkflowEvidence(instanceId: string) {
    return this.get(
      `/api/v1/agents/workflows/instances/${instanceId}/evidence`,
    );
  },
  async getWorkflowDependencies(id: string) {
    return this.get(`/api/v1/agents/workflows/${id}/dependencies`);
  },
  async getWorkflowSimulations(versionId: string) {
    return this.get(`/api/v1/agents/workflows/versions/${versionId}/simulations`);
  },
  async getWorkflowValidate(versionId: string) {
    return this.get(`/api/v1/agents/workflows/versions/${versionId}/validate`);
  },
  async getThreeKeyChain(versionId: string) {
    return this.get(`/api/v1/agents/workflows/three-key/${versionId}`);
  },
  async getThreeKeyQuorum(versionId: string) {
    return this.get(`/api/v1/agents/workflows/three-key/${versionId}/quorum`);
  },
  async listPendingThreeKeyChains() {
    return this.get(`/api/v1/agents/workflows/three-key/pending/list`);
  },

  // ─── WORKFLOW CANVAS BUILDER API ───
  async saveWorkflowGraph(versionId: string, nodes: any[], edges: any[]) {
    return this.post(`/api/v1/agents/workflows/versions/${versionId}/graph`, { nodes, edges });
  },
  async saveWorkflowStepConfig(stepId: string, updates: any) {
    return this.patch(`/api/v1/agents/workflows/steps/${stepId}`, updates);
  },

  // ─── WORKFLOW EXPORT API ───
  async exportWorkflow(id: string, reason?: string) {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return this.get(`/api/v1/agents/workflows/${id}/export${query}`);
  },
  async exportApprovalsCsv(id: string, reason?: string) {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return this.get(`/api/v1/agents/workflows/${id}/export/approvals${query}`);
  },
  async exportWorkflowPdfReady(id: string) {
    return this.get(`/api/v1/agents/workflows/${id}/export/pdf-ready`);
  },
  async exportRuntimeTimeline(id: string, reason?: string) {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return this.get(`/api/v1/agents/workflows/${id}/export/timeline${query}`);
  },
  async exportEvidenceByRef(evidenceRef: string, reason?: string) {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return this.get(`/api/v1/agents/workflows/export/evidence/${evidenceRef}${query}`);
  },
  async triggerWorkflowNotification(id: string, body: any) {
    return this.post(`/api/v1/agents/workflows/${id}/notify`, body);
  },

  // ─── PROMPTS API CLIENT ───
  async getPromptStats() {
    return this.get("/api/v1/prompts/stats");
  },

  async getPromptApprovalStats() {
    return this.get("/api/v1/prompts/approvals/stats");
  },

  async approvePromptVersion(versionId: string) {
    return this.post(`/api/v1/prompts/versions/${versionId}/approve`, {});
  },

  async rejectPromptVersion(versionId: string) {
    return this.post(`/api/v1/prompts/versions/${versionId}/reject`, {});
  },

  async deployPromptVersion(versionId: string) {
    return this.post(`/api/v1/prompts/versions/${versionId}/deploy`, {});
  },

  async listPromptTestRuns(versionId: string) {
    return this.get(`/api/v1/prompts/versions/${versionId}/tests/runs`);
  },

  async runPromptTests(versionId: string) {
    return this.post(`/api/v1/prompts/versions/${versionId}/tests/run`, {});
  },

  async listPrompts() {
    return this.get("/api/v1/prompts");
  },

  async createPrompt(data: any) {
    return this.post("/api/v1/prompts", data);
  },

  async getPrompt(id: string) {
    return this.get(`/api/v1/prompts/${id}`);
  },

  async updatePrompt(id: string, data: any) {
    return this.patch(`/api/v1/prompts/${id}`, data);
  },

  async clonePrompt(id: string) {
    return this.post(`/api/v1/prompts/${id}/clone`, {});
  },

  async pausePrompt(id: string) {
    return this.post(`/api/v1/prompts/${id}/pause`, {});
  },

  async resumePrompt(id: string) {
    return this.post(`/api/v1/prompts/${id}/resume`, {});
  },

  async archivePrompt(id: string) {
    return this.post(`/api/v1/prompts/${id}/archive`, {});
  },

  async retirePrompt(id: string) {
    return this.post(`/api/v1/prompts/${id}/retire`, {});
  },

  async submitPromptForReview(id: string) {
    return this.post(`/api/v1/prompts/${id}/submit-review`, {});
  },

  async rollbackPrompt(id: string) {
    return this.post(`/api/v1/prompts/${id}/rollback`, {});
  },

  async listPromptVersions(id: string) {
    return this.get(`/api/v1/prompts/${id}/versions`);
  },

  async createPromptVersion(id: string, data: any) {
    return this.post(`/api/v1/prompts/${id}/versions`, data);
  },

  // Test Center — classify a post description through the governance pipeline.
  async classifyTestDescription(body: { description: string; platform?: string; prompt_id?: string }) {
    return this.post("/api/v1/prompts/test-center/classify", body);
  },

  // ─── KNOWLEDGE BASE API CLIENT ───
  async listKnowledgeBases() {
    return this.get("/api/v1/knowledge/bases");
  },

  async createKnowledgeBase(data: any) {
    return this.post("/api/v1/knowledge/bases", data);
  },

  async deleteKnowledgeBase(baseId: string) {
    return this.delete(`/api/v1/knowledge/bases/${baseId}`);
  },

  async listKnowledgeCollections() {
    return this.get("/api/v1/knowledge/collections");
  },

  async getKnowledgeCollection(id: string) {
    return this.get(`/api/v1/knowledge/collections/${id}`);
  },

  async createKnowledgeCollection(data: any) {
    return this.post("/api/v1/knowledge/collections", data);
  },

  async updateKnowledgeCollection(id: string, data: any) {
    return this.patch(`/api/v1/knowledge/collections/${id}`, data);
  },

  async deleteKnowledgeCollection(id: string) {
    return this.delete(`/api/v1/knowledge/collections/${id}`);
  },

  async listKnowledgeSources() {
    return this.get("/api/v1/knowledge/sources");
  },

  async createKnowledgeSource(collectionId: string, formData: FormData) {
    return this.postMultipart(
      `/api/v1/knowledge/collections/${collectionId}/sources`,
      formData,
    );
  },

  async getKnowledgeSource(id: string) {
    return this.get(`/api/v1/knowledge/sources/${id}`);
  },

  async updateKnowledgeSource(id: string, data: any) {
    return this.patch(`/api/v1/knowledge/sources/${id}`, data);
  },

  async deleteKnowledgeSource(id: string) {
    return this.delete(`/api/v1/knowledge/sources/${id}`);
  },

  // AI-assisted governance category check (Groq primary, Gemini optional fallback).
  async classifySourceGovernance(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/classify-governance`, {});
  },

  // Admin / workspace owner resolves a governance-category check.
  // decision: 'accept' | 'keep' | 'review'
  async decideSourceGovernance(id: string, body: { decision: "accept" | "keep" | "review"; reason?: string }) {
    return this.post(`/api/v1/knowledge/sources/${id}/governance-decision`, body);
  },

  async listKnowledgeReviews(sourceId: string) {
    return this.get(`/api/v1/knowledge/reviews?source_id=${encodeURIComponent(sourceId)}`);
  },

  async listTeamMembers() {
    return this.get("/api/v1/team/members");
  },

  async decideKnowledgeTransfer(id: string, decision: "allow" | "block") {
    return this.post(`/api/v1/knowledge/sources/${id}/transfer/decision`, { decision });
  },

  async approveKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/approve`, {});
  },

  async rejectKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/reject`, {});
  },

  async retireKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/retire`, {});
  },

  async activateKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/activate`, {});
  },

  async publishKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/publish`, {});
  },

  async restrictKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/restrict`, {});
  },

  async quarantineKnowledgeSource(id: string) {
    return this.post(`/api/v1/knowledge/sources/${id}/quarantine`, {});
  },

  async getKnowledgeStats() {
    return this.get("/api/v1/knowledge/stats");
  },

  async listKnowledgeConflicts() {
    return this.get("/api/v1/knowledge/conflicts");
  },

  async listKnowledgeRetrievalLogs() {
    return this.get("/api/v1/knowledge/retrieval-logs");
  },

  // Inbox & Engagement API
  async getInboxMessages(params?: { tab?: string; platform?: string; type?: string; risk?: string; search?: string; page?: number; limit?: number }) {
    return this.listInboxMessages(params);
  },

  async listInboxMessages(params?: { tab?: string; platform?: string; type?: string; risk?: string; search?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.tab) query.set('tab', params.tab);
    if (params?.platform) query.set('platform', params.platform);
    if (params?.type) query.set('type', params.type);
    if (params?.risk) query.set('risk', params.risk);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return this.get(`/api/v1/inbox/messages?${query.toString()}`);
  },

  async getInboxMessage(id: string) {
    return this.get(`/api/v1/inbox/messages/${id}`);
  },

  async createInboxReply(messageId: string, body: { reply_body: string; reply_type?: string; ai_tone?: string }) {
    return this.post(`/api/v1/inbox/messages/${messageId}/reply`, body);
  },

  async generateAiDraft(messageId: string, tone?: string) {
    return this.post(`/api/v1/inbox/messages/${messageId}/reply/generate`, { tone: tone || 'professional' });
  },

  async sendInboxReply(messageId: string) {
    return this.post(`/api/v1/inbox/messages/${messageId}/reply/send`, {});
  },

  async assignInboxMessage(messageId: string, assigned_to: string | null) {
    return this.post(`/api/v1/inbox/messages/${messageId}/assign`, { assigned_to });
  },

  async updateInboxMessageStatus(messageId: string, status: string) {
    return this.patch(`/api/v1/inbox/messages/${messageId}/status`, { status });
  },

  async escalateInboxMessage(messageId: string, body: { escalation_reason: string; risk_category: string; assigned_reviewer?: string }) {
    return this.post(`/api/v1/inbox/messages/${messageId}/escalate`, body);
  },

  async archiveInboxMessage(messageId: string) {
    return this.post(`/api/v1/inbox/messages/${messageId}/archive`, {});
  },

  async deleteInboxMessages(ids: string[]) {
    return this.post('/api/v1/inbox/messages/delete', { ids });
  },

  async addInboxNote(messageId: string, note_body: string) {
    return this.post(`/api/v1/inbox/messages/${messageId}/notes`, { note_body });
  },

  async getInboxMessageAudit(messageId: string) {
    return this.get(`/api/v1/inbox/messages/${messageId}/audit`);
  },

  async getInboxEscalationQueue() {
    return this.get('/api/v1/inbox/escalations');
  },

  async resolveInboxEscalation(escalationId: string, body: { decision: 'APPROVED' | 'REJECTED'; decision_note?: string }) {
    return this.post(`/api/v1/inbox/escalations/${escalationId}/resolve`, body);
  },

  async syncInboxMessages() {
    return this.post('/api/v1/inbox/sync', {});
  },

  async getInboxPostPreview(messageId: string) {
    return this.get(`/api/v1/inbox/messages/${messageId}/post-preview`);
  },

  async getPublishedPostMeta(id: string, source: "publish" | "schedule") {
    return this.get(`/api/v1/agents/workflows/published-content/${id}/meta?source=${source}`);
  },

  async listInboxAutoReplyRules() {
    return this.get('/api/v1/inbox/settings/auto-reply');
  },

  async createInboxAutoReplyRule(body: { rule_name?: string; keywords: string[]; reply_body: string; is_active?: boolean; is_case_sensitive?: boolean }) {
    return this.post('/api/v1/inbox/settings/auto-reply', body);
  },

  async updateInboxAutoReplyRule(id: string, body: { rule_name?: string; keywords?: string[]; reply_body?: string; is_active?: boolean; is_case_sensitive?: boolean }) {
    return this.patch(`/api/v1/inbox/settings/auto-reply/${id}`, body);
  },

  async deleteInboxAutoReplyRule(id: string) {
    return this.post(`/api/v1/inbox/settings/auto-reply/${id}/delete`, {});
  },

  async getPlatformReach() {
    return this.get('/api/v1/analytics/platform-reach');
  },
};
