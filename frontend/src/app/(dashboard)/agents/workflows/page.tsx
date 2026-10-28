"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import ActiveOrchestrations from "./components/ActiveOrchestrations";
import WorkflowRunDetailDrawer from "./components/WorkflowRunDetailDrawer";
import PublishedContentPanel, { type PublishedContentItem } from "./components/PublishedContentPanel";
import PostDetailModal from "./components/PostDetailModal";
import {
  RefreshCw,
  GitBranch,
  FileCheck2,
  AlertTriangle,
  XCircle,
  AlertCircle,
  GitMerge,
  CheckCircle2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface ControlStripData {
  activeWorkflows: number;
  pendingApprovals?: number;
  blockedRuns: number;
  failedRuns: number;
  criticalRiskItems: number;
  highRiskRuns?: number;
  completedToday?: number;
}

interface ApprovalStats {
  counts?: {
    total_pending?: number;
    pending_validation?: number;
    pending_authorization?: number;
    pending_governance?: number;
  };
}

const INSTANCE_STATUS_MAP: Record<string, string> = {
  pending: "Pending",
  running: "In Progress",
  waiting_approval: "Waiting",
  waiting_review: "Waiting",
  paused: "Paused",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Failed",
};

function formatRelativeMinutes(date?: string | null) {
  if (!date) return "Just now";
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function mapActiveInstance(instance: any) {
  return {
    id: instance.id,
    workflowId: instance.workflow_id,
    workflowName: safeStr(
      instance.workflowName ||
        instance.workflow_templates?.name,
      "Workflow Run",
    ),
    currentStep: safeStr(
      instance.currentStep ||
        instance.current_step_name ||
        instance.current_step_id,
      "Awaiting Step",
    ),
    agentAssigned: safeStr(
      instance.agentAssigned ||
        instance.assigned_agent_name,
      "Assigned Agent",
    ),
    validationAgents: Array.isArray(instance.validationAgents)
      ? instance.validationAgents
      : [],
    owner: safeStr(instance.owner || instance.started_by) || undefined,
    status: INSTANCE_STATUS_MAP[instance.status] || safeStr(instance.status, "Pending"),
    timeInStep: formatRelativeMinutes(
      instance.started_at || instance.created_at,
    ),
    startedAt: instance.started_at || instance.created_at,
    riskScore: typeof instance.risk_score === "number" ? instance.risk_score : undefined,
    confidenceScore: typeof instance.confidence_score === "number" ? instance.confidence_score : undefined,
    sla: instance.due_at
      ? new Date(instance.due_at).toLocaleString()
      : undefined,
    blocker: (() => {
      const raw = instance.blocker || instance.reason_code;
      return raw && typeof raw === "string" ? raw : undefined;
    })(),
    post: instance.post && typeof instance.post === "object"
      ? {
          id: safeStr(instance.post.id, ""),
          platform: safeStr(instance.post.platform, ""),
          excerpt: safeStr(instance.post.excerpt, ""),
        }
      : undefined,
    prompt: instance.prompt || instance.execution_prompt || undefined,
    knowledgeBaseSource:
      instance.knowledgeBaseSource ||
      instance.knowledge_base_source ||
      instance.knowledge_source ||
      undefined,
    nextStep:
      instance.nextStep || instance.next_step || instance.nextAction || instance.next_action || undefined,
    kbCollection: instance.kbCollection || instance.kb_collection || undefined,
    reviewerName: instance.reviewerName || undefined,
    reviewerRole: instance.reviewerRole || undefined,
    reviewDecision: instance.reviewDecision || undefined,
    reviewComment: instance.reviewComment || undefined,
    reviewedAt: instance.reviewedAt || undefined,
  };
}

// ── Safe render helpers ────────────────────────────────────────────────────

function safeStr(v: unknown, fallback = "—"): string {
  if (v === null || v === undefined || typeof v === "object") return fallback;
  return String(v);
}

function safeNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || typeof v !== "number") return fallback;
  return v;
}

// ── Control Strip ──────────────────────────────────────────────────────────

function ControlStrip({
  data,
  posts,
}: {
  data?: ControlStripData;
  posts?: PublishedContentItem[];
}) {
  // Derive the content indicators from the SAME posts shown in the Published
  // Content panel, so the numbers always match the cards (and a UI delete drops
  // the matching indicator by 1 automatically). Each post's verdict drives one
  // bucket: block → Blocked, review → Pending Approvals, otherwise → Successful.
  // Failed Runs stays a true workflow-execution count from the stats endpoint.
  const items = posts ?? [];
  let successful = 0;
  let pendingReview = 0;
  let blocked = 0;
  let highRisk = 0;
  for (const it of items) {
    const v = it.check?.verdict;
    if (v === "block") blocked++;
    else if (v === "review") pendingReview++;
    else successful++;
    if ((it.check?.risk ?? 0) >= 70) highRisk++;
  }
  const failed = data?.failedRuns ?? 0;

  const strip = [
    {
      label: "Successful Runs",
      value: successful,
      icon: CheckCircle2,
      color: "text-success-text",
      urgent: false,
      success: true,
    },
    {
      label: "Pending Approvals",
      value: pendingReview,
      icon: FileCheck2,
      color: "text-warning-text",
      urgent: pendingReview > 0,
      success: false,
    },
    {
      label: "Blocked Runs",
      value: blocked,
      icon: XCircle,
      color: "text-error-text",
      urgent: blocked > 0,
      success: false,
    },
    {
      label: "Failed Runs",
      value: failed,
      icon: AlertCircle,
      color: "text-red-400",
      urgent: failed > 0,
      success: false,
    },
    {
      label: "High-Risk Runs",
      value: highRisk,
      icon: AlertTriangle,
      color: "text-error-text",
      urgent: highRisk > 0,
      success: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {strip.map((item) => (
        <div
          key={item.label}
          className={`flex flex-col gap-1.5 p-3.5 rounded-xl border transition-all overflow-hidden ${
            item.urgent
              ? "bg-error-text/5 border-error-border/20"
              : item.success
              ? "bg-success-text/5 border-success-text/20"
              : "bg-[var(--surface)] border-[var(--border)]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <item.icon className={`w-3.5 h-3.5 shrink-0 ${item.color}`} />
            <span className="text-[10px] font-semibold uppercase tracking-wide leading-tight break-words min-w-0 text-[var(--text-muted)]">
              {item.label}
            </span>
          </div>
          <p
            className={`text-2xl font-bold ${item.urgent ? "text-error-text" : item.success ? "text-success-text" : "text-[var(--text-primary)]"}`}
          >
            {safeNum(item.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const [stats, setStats] = useState<any>(undefined);
  const [active, setActive] = useState<any[]>([]);
  const [publishedContent, setPublishedContent] = useState<any[] | undefined>(undefined);
  // Kept only to consume the approvals/stats fetch; indicators no longer read it.
  const [, setApprovalStats] = useState<ApprovalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [selectedPost, setSelectedPost] = useState<PublishedContentItem | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const responses = await Promise.allSettled([
      api.get("/api/v1/agents/workflows/stats"),
      api.get("/api/v1/agents/workflows/active"),
      api.get("/api/v1/agents/workflows/approvals/stats"),
      api.get("/api/v1/agents/workflows/published-content"),
    ]);
    const [
      statsRes,
      activeRes,
      approvalsRes,
      publishedRes,
    ] = responses.map((r) =>
      r.status === "fulfilled" ? r.value : { success: false, data: null },
    );
    if (statsRes.success) setStats(statsRes.data);
    if (activeRes.success)
      setActive((activeRes.data || []).map(mapActiveInstance));
    if (approvalsRes.success) setApprovalStats(approvalsRes.data || null);
    if (publishedRes.success) setPublishedContent(publishedRes.data || []);
    else setPublishedContent([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const safeFetch = () => { if (!cancelled && document.visibilityState === 'visible') fetchAll(); };
    safeFetch();
    const interval = setInterval(safeFetch, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchAll]);

  // Delete a post: removes it from the DB (post row + linked workflow instance +
  // operations run) AND from the UI. The card disappears, its row in the Live
  // Workflow Runs table is removed, and the indicators recompute from the
  // remaining `publishedContent` (block → Blocked Runs, review → Pending
  // Approvals, else → Successful Runs). Optimistic: revert via refetch on error.
  const handleDeletePost = useCallback(
    async (item: PublishedContentItem) => {
      const prevPublished = publishedContent;
      const prevActive = active;
      // Optimistic UI removal — cards, Live Workflow row (matched by post id),
      // and the derived indicators all update immediately.
      setPublishedContent((prev) =>
        (prev || []).filter((p) => !(p.id === item.id && p.source === item.source)),
      );
      setActive((prev) => prev.filter((o) => o.post?.id !== item.id));
      setSelectedPost((prev) => (prev?.id === item.id && prev.source === item.source ? null : prev));
      try {
        const res = await api.delete(
          `/api/v1/agents/workflows/published-content/${item.id}?source=${item.source}`,
        );
        if (!res?.success) throw new Error(res?.error || "Delete failed");
      } catch {
        // Restore the prior state if the server delete failed.
        setPublishedContent(prevPublished);
        setActive(prevActive);
      }
    },
    [publishedContent, active],
  );


  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-info-text/10 rounded-2xl border border-info-border/20">
            <GitBranch className="w-7 h-7 text-info-text" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                Agent Workflows
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-success-text/10 text-success-text border-success-border/20 uppercase tracking-widest">
                Production
              </span>
            </div>
            <p className="text-[var(--text-secondary)] mt-1 text-sm">
              Governed execution circuits — chained actions, decision gates,
              approvals, policy checks, and evidence capture.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-success-text/10 border border-success-border/20 rounded-full text-xs font-medium text-success-text">
            <span className="w-1.5 h-1.5 bg-success-text rounded-full animate-pulse" />
            Auto-refresh 60s
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Indicators ── */}
      <ControlStrip data={stats} posts={publishedContent} />

      {/* ── Published Content ── */}
      <PublishedContentPanel data={publishedContent} onDelete={handleDeletePost} onSelect={setSelectedPost} />
      <PostDetailModal item={selectedPost} onClose={() => setSelectedPost(null)} />

      {/* ── Live Workflow Runs ── */}
      <ActiveOrchestrations
        data={active}
        onActionComplete={fetchAll}
        onRowClick={setSelectedRun}
      />
      <WorkflowRunDetailDrawer
        run={selectedRun}
        onClose={() => setSelectedRun(null)}
      />
    </div>
  );
}
