 
import { Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import { AuthRequest } from '../../shared/authMiddleware';
import * as templateService from '../../services/workflowTemplate.service';
import * as versionService from '../../services/workflowVersion.service';
import * as runtimeService from '../../services/workflowRuntime.service';
import * as approvalService from '../../services/workflowApproval.service';
import * as simulationService from '../../services/workflowSimulation.service';
import * as analyticsService from '../../services/workflowAnalytics.service';
import * as evidenceService from '../../services/workflowEvidence.service';
import * as dependencyService from '../../services/workflowDependency.service';
import * as builderService from '../../services/workflowBuilder.service';
import * as threeKeyService from '../../services/workflowThreeKey.service';
import * as exportService from '../../services/workflowExport.service';
import * as notificationService from '../../services/workflowNotification.service';
import { enrichInstancesWithReview, getRecentPublishedContent, deletePublishedContent } from '../../services/workflowPublishLink.service';
import { getPublishedPostMeta } from '../../services/publishedPostMeta.service';
import { getParam, getQueryNumber, getQueryValue } from '../../shared/request';
import { executeInstance } from '../../modules/workflow-engine/executor';

function normalizeWorkflowGraph(steps: any[], edges: any[]) {
  const columnWidth = 170;
  const startX = 120;
  const centerY = 210;

  return {
    nodes: (steps || []).map((step: any, index: number) => ({
      id: step.id,
      type: step.step_type || 'action',
      label: step.name || step.step_type || `Step ${index + 1}`,
      x: startX + index * columnWidth,
      y: centerY,
    })),
    edges: (edges || []).map((edge: any) => ({
      id: edge.id,
      source: edge.from_step_id,
      target: edge.to_step_id,
      label: edge.branch_label || edge.condition || undefined,
    })),
  };
}

/**
 * Build a read-only, auto-generated governed flow from the workspace's agents.
 *
 * The flow is NOT authored or editable by users — it is derived from how the
 * agents are actually configured (knowledge, policy, approval, publish, evidence)
 * so users can SEE and LEARN the governed path agents move through. Stages appear
 * only when at least one active agent requires them; agents render as inline
 * Agent Action nodes in creation order. When no agents exist yet, a canonical
 * illustrative flow is shown so the page still teaches the intended pipeline.
 */
function buildAgentDrivenGraph(agents: any[]) {
  const colW = 170;
  const startX = 120;
  const y = 210;
  const nodes: any[] = [];
  const edges: any[] = [];
  let col = 0;

  const add = (type: string, label: string, idSuffix: string): string => {
    const id = `flow_${idSuffix}`;
    nodes.push({ id, type, label, x: startX + col * colW, y });
    col += 1;
    return id;
  };

  const active = (agents || []).filter((a) =>
    ['ACTIVE', 'APPROVED', 'DEPLOYED'].includes(String(a?.status || '').toUpperCase()),
  );
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  // Governance stages are shown when ANY active agent requires them.
  // approval_required / evidence_required default to true in the schema.
  let anyKnowledge = active.some((a) => arr(a.linked_knowledge_sources).length > 0);
  let anyPolicy    = active.some((a) => arr(a.linked_policies).length > 0);
  let anyApproval  = active.some((a) => a.approval_required !== false);
  let anyPublish   = active.some((a) => arr(a.platforms).length > 0 || arr(a.linked_channels).length > 0);
  let anyEvidence  = active.some((a) => a.evidence_required !== false);

  const shown = active.slice(0, 10); // cap to keep the flow readable

  // No agents yet → show the full canonical governed flow as a teaching default.
  if (shown.length === 0) {
    anyKnowledge = anyPolicy = anyApproval = anyPublish = anyEvidence = true;
  }

  const seq: string[] = [];
  seq.push(add('trigger', 'Trigger', 'trigger'));
  if (anyKnowledge) seq.push(add('knowledge', 'Knowledge Lookup', 'knowledge'));

  if (shown.length === 0) {
    seq.push(add('agent', 'Agent Action', 'agent_default'));
  } else {
    shown.forEach((a, i) => {
      const label = a.name || a.type || `Agent ${i + 1}`;
      seq.push(add('agent', String(label), `agent_${a.id || i}`));
    });
  }

  if (anyPolicy)   seq.push(add('policy', 'Policy Check', 'policy'));
  if (anyApproval) seq.push(add('approval', 'Approval Gate', 'approval'));
  if (anyPublish)  seq.push(add('publish', 'Publish', 'publish'));
  if (anyEvidence) seq.push(add('evidence', 'Evidence Capture', 'evidence'));
  seq.push(add('end', 'End', 'end'));

  for (let i = 0; i < seq.length - 1; i += 1) {
    edges.push({ id: `e_${seq[i]}_${seq[i + 1]}`, source: seq[i], target: seq[i + 1] });
  }

  return { nodes, edges };
}

// ─── helper: extract a human-readable message from any thrown value ───────────
function extractErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as any;
  // Supabase / Postgres error shapes
  if (e?.message) return e.message;
  if (e?.details) return e.details;
  if (e?.hint)    return e.hint;
  return String(err);
}

/** GET /api/v1/agents/workflows — List workflow templates with optional filters (status, risk_level, type, owner_id, search, pagination). */
export const listWorkflows = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const status     = getQueryValue(req, 'status');
    const risk_level = getQueryValue(req, 'risk_level');
    const type       = getQueryValue(req, 'type');
    const owner_id   = getQueryValue(req, 'owner_id');
    const search     = getQueryValue(req, 'search');
    const business_unit_id = getQueryValue(req, 'business_unit_id');
    const limit      = getQueryNumber(req, 'limit', 50);
    const offset     = getQueryNumber(req, 'offset', 0);
    const result = await templateService.listTemplates({
      workspace_id: workspaceId,
      status,
      risk_level,
      type,
      owner_id,
      search,
      business_unit_id,
      limit,
      offset,
    });
    res.json({ success: true, data: result.templates, total: result.total });
  } catch (err) {
    logger.error({ err }, 'Failed to list workflows');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/:id — Get a single workflow template by ID. */
export const getWorkflow = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const template = await templateService.getTemplate(id);
    res.json({ success: true, data: template });
  } catch (err) {
    logger.error({ err }, 'Failed to get workflow');
    next(err);
  }
};

/** POST /api/v1/agents/workflows — Create a new workflow template with name, description, risk_level, brand_ids, platforms, type. */
export const createWorkflow = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    const userId      = req.user?.id;
    const userName    = req.user?.email || 'Unknown';

    if (!workspaceId) {
      return res.status(403).json({ success: false, error: 'Workspace not found' });
    }

    const { name, description, risk_level, brand_ids, platforms, type, business_unit_id } = req.body;

    // ── FIX: validate required fields and return 400 instead of letting
    //    Supabase throw a not-null / check-constraint error that surfaces as 500.
    if (!name || typeof name !== 'string' || name.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Workflow name is required and must be at least 3 characters.',
      });
    }

    const result = await templateService.createTemplate({
      workspace_id: workspaceId,
      name:         name.trim(),
      description:  description?.trim() || undefined,
      risk_level:   risk_level || 'medium',
      owner_id:     userId || 'system',
      owner_name:   userName,
      brand_ids:    Array.isArray(brand_ids) ? brand_ids : [],
      platforms:    Array.isArray(platforms) ? platforms : [],
      type:         type || 'governed',
      business_unit_id: business_unit_id || null,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to create workflow');
    // ── FIX: return a structured 500 with the real message instead of
    //    letting the generic error handler emit an opaque 500 body.
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** PATCH /api/v1/agents/workflows/:id — Update workflow template metadata. */
export const updateWorkflow = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const { name, description, risk_level, owner_id, owner_name, brand_ids, platforms, business_unit_id } = req.body;
    const result = await templateService.updateTemplate(id, { name, description, risk_level, owner_id, owner_name, brand_ids, platforms, business_unit_id });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to update workflow');
    const statusCode = (err as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** POST /api/v1/agents/workflows/:id/duplicate — Duplicate a workflow template. */
export const duplicateWorkflow = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const { name } = req.body;
    const result = await templateService.duplicateTemplate(id, name);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to duplicate workflow');
    next(err);
  }
};

/** DELETE /api/v1/agents/workflows/:id — Delete a draft workflow template. */
export const deleteWorkflow = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    await templateService.deleteDraftTemplate(id);
    res.json({ success: true, message: 'Workflow deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete workflow');
    const statusCode = (err as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** GET /api/v1/agents/workflows/:id/versions — List all versions of a workflow. */
export const listVersions = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const versions = await versionService.listVersions(id);
    res.json({ success: true, data: versions });
  } catch (err) {
    logger.error({ err }, 'Failed to list versions');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/:id/versions — Create a new draft version. */
export const createDraftVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const { change_summary, change_reason } = req.body;
    const userId = req.user?.id || 'system';
    const result = await versionService.createDraftVersion(id, change_summary, change_reason, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to create draft version');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/submit — Submit version for approval + init Three-Key chain. */
export const submitForApproval = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const userId = req.user?.id || 'system';

    // 1. Change version state to pending_approval
    const result = await versionService.submitForApproval(versionId);

    // 2. Get version and template to determine risk level
    const version = await versionService.getVersion(versionId);
    const template = await templateService.getTemplate(version.workflow_id);

    // 3. Initialize Three-Key approval chain
    const chain = await threeKeyService.initializeApprovalChain({
      versionId,
      workflowId: version.workflow_id,
      riskLevel: template.risk_level || 'medium',
      createdBy: userId,
    });

    res.json({
      success: true,
      data: {
        ...result,
        approvalChain: chain,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to submit for approval');
    const statusCode = (err as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/approve — Approve a version. */
export const approveVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const userId = req.user?.id || 'system';
    const result = await versionService.approveVersion(versionId, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to approve version');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/reject — Reject a version with reason. */
export const rejectVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const { reason } = req.body;
    const result = await versionService.rejectVersion(versionId, reason);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to reject version');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/activate — Activate version (checks Three-Key quorum). */
export const activateVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const userId = req.user?.id || 'system';

    // Check Three-Key approval quorum before activation
    const version = await versionService.getVersion(versionId);
    const eligibility = await threeKeyService.checkActivationEligibility({
      versionId,
      workflowId: version.workflow_id,
    });
    if (!eligibility.eligible) {
      return res.status(409).json({
        success: false,
        error: 'Activation blocked by approval requirements',
        blockers: eligibility.blockers,
      });
    }

    const result = await versionService.activateVersion(versionId, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to activate version');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/:id/rollback — Rollback to a previous version. */
export const rollbackVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const { target_version_id, reason } = req.body;
    const userId = req.user?.id || 'system';
    const result = await versionService.rollbackVersion(id, target_version_id, reason, userId);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to rollback version');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/pause — Pause the active version. */
export const pauseWorkflow = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'versionId');
    const result = await versionService.pauseVersion(id);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to pause workflow');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/retire — Retire the active version. */
export const retireWorkflow = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'versionId');
    const result = await versionService.retireVersion(id);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to retire workflow');
    next(err);
  }
};

/**
 * GET /api/v1/agents/workflows/graph — Auto-generated, read-only governed flow.
 *
 * The dashboard canvas is a view-only learning surface, not a builder. The flow
 * is generated from the workspace's active agents and their governance config
 * (see buildAgentDrivenGraph), so it always reflects how agents actually move
 * through Trigger → Knowledge → Agent Action → Policy → Approval → Publish →
 * Evidence → End. Users cannot edit or reorder it.
 */
export const getWorkflowGraphGeneral = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    const { supabaseAdmin } = await import('../../shared/supabase');

    let query = supabaseAdmin
      .from('agents')
      .select('id, name, type, status, risk_level, autonomy_level, linked_knowledge_sources, linked_policies, linked_channels, platforms, approval_required, evidence_required, created_at')
      .order('created_at', { ascending: true })
      .limit(20);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data: agents, error } = await query;
    // Missing table or query error → still return the canonical teaching flow.
    if (error && (error as any).code !== '42P01') {
      logger.warn({ err: error }, 'Agent fetch failed for workflow graph; using canonical default');
    }
    res.json({ success: true, data: buildAgentDrivenGraph(agents || []) });
  } catch (err) {
    logger.error({ err }, 'Failed to build agent-driven workflow graph');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/versions/:versionId/graph — Get graph (steps + edges) for a version. */
export const getWorkflowGraph = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const [stepsResult, edgesResult] = await Promise.all([
      import('../../shared/supabase').then((m) => m.supabaseAdmin.from('workflow_steps').select('*').eq('version_id', versionId).order('sequence', { ascending: true })),
      import('../../shared/supabase').then((m) => m.supabaseAdmin.from('workflow_edges').select('*').eq('version_id', versionId)),
    ]);
    if (stepsResult.error) throw stepsResult.error;
    if (edgesResult.error) throw edgesResult.error;
    res.json({ success: true, data: normalizeWorkflowGraph(stepsResult.data || [], edgesResult.data || []) });
  } catch (err) {
    logger.error({ err }, 'Failed to get workflow graph');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/versions/:versionId/validate — Validate workflow readiness. */
export const validateReadiness = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const result = await builderService.validateWorkflowReadiness(versionId);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to validate readiness');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/published-content — Recent posts from the Publish Hub, tagged with the relevant agent. */
export const getPublishedContent = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const limit = getQueryNumber(req, 'limit', 24);
    const items = await getRecentPublishedContent(workspaceId, limit);
    res.json({ success: true, data: items });
  } catch (err) {
    logger.error({ err }, 'Failed to get published content');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/published-content/:id/meta — live post details from Meta (permalink, media, timestamp). */
export const getPublishedContentMeta = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Post id is required' });
    // scheduled_posts rows carry no account or platform post id to look up
    if (getQueryValue(req, 'source') === 'schedule') {
      return res.json({ success: true, data: { status: 'scheduled', platform: null, posts: [] } });
    }
    const data = await getPublishedPostMeta(workspaceId, id);
    if (!data) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, 'Failed to get published content metadata');
    next(err);
  }
};

/** DELETE /api/v1/agents/workflows/published-content/:id — remove a post and its workflow footprint (real DB delete). */
export const deletePublishedContentItem = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'Post id is required' });
    const source = getQueryValue(req, 'source') === 'schedule' ? 'schedule' : 'publish';
    const result = await deletePublishedContent(workspaceId, id, source);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to delete published content');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/active — List active workflow instances. */
export const getActiveOrchestrations = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const result = await runtimeService.listInstances({
      workspace_id: workspaceId,
      status: getQueryValue(req, 'status'),
      limit: getQueryNumber(req, 'limit', 50),
      offset: getQueryNumber(req, 'offset', 0),
    });
    // Expand publish-hub-linked instances so the agent + post show in the UI,
    // then resolve KB collection + human review (reviewer, role, comment) data.
    const data = await enrichInstancesWithReview(result.instances || [], workspaceId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, 'Failed to get active orchestrations');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/stats — Aggregated workflow stats (completion, SLA, approvals, risks). */
export const getWorkflowStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const m  = await analyticsService.getWorkflowAnalytics(workspaceId);
    const cs = await analyticsService.getControlStripData(workspaceId);
    res.json({
      success: true,
      data: {
        completionRate:       m.completion_rate,
        avgHandoffDelay:      '—',
        escalationRate:       0,
        activeOrchestrations: m.active_runs,
        blockedRunRate:       m.blocked_run_rate,
        slaBreachRate:        m.sla_breach_rate,
        policyFailureRate:    m.failure_rate,
        evidenceComplete:     m.evidence_completeness,
        avgApprovalTime:      '—',
        overrideRate:         0,
        activeWorkflows:      cs.activeWorkflows,
        pendingApprovals:     cs.pendingApprovals + m.pending_approvals,
        blockedRuns:          cs.blockedRuns,
        failedRuns:           cs.failedRuns,
        slaBreach:            cs.slaBreach,
        staleDependencies:    cs.staleDependencies,
        criticalRiskItems:    cs.criticalRiskItems,
        highRiskRuns:         cs.highRiskRuns,
        completedToday:       cs.completedToday,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get workflow stats');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/analytics — Raw analytics metrics for dashboards. */
export const getWorkflowAnalytics = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const metrics = await analyticsService.getWorkflowAnalytics(workspaceId);
    res.json({ success: true, data: metrics });
  } catch (err) {
    logger.error({ err }, 'Failed to get analytics');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/control-strip — Control strip data for top-of-page KPI bar. */
export const getControlStrip = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const data = await analyticsService.getControlStripData(workspaceId);
    res.json({ success: true, data });
  } catch (err) {
    logger.error({ err }, 'Failed to get control strip data');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/escalations — List escalation incidents for the workspace. */
export const getEscalationPaths = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const { data: incidents, error } = await import('../../shared/supabase').then((m) =>
      m.supabaseAdmin.from('incidents').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(10)
    );
    if (error) {
      if ((error as any).code === '42P01') return res.json({ success: true, data: [] });
      throw error;
    }
    res.json({ success: true, data: incidents || [] });
  } catch (err) {
    logger.error({ err }, 'Failed to get escalation paths');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/instances — Start a new workflow instance + kick off executor. */
export const startWorkflowInstance = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const { workflow_id, version_id, trigger_type, trigger_source, priority } = req.body;

    // ── FIX: guard required fields so missing IDs don't crash the service layer.
    if (!workflow_id) {
      return res.status(400).json({ success: false, error: 'workflow_id is required' });
    }

    const userId = req.user?.id || 'system';
    const workspaceId = req.user?.workspace_id ?? undefined;
    const result = await runtimeService.startInstance(workflow_id, version_id, userId, trigger_type, trigger_source, priority, workspaceId);

    // ── NEW: kick off the executor synchronously. The executor will
    //    pause on approval gates / blocks and return; subsequent calls
    //    via /execute resume from the next pending step. We swallow
    //    executor errors here so startInstance always returns the row
    //    that was created — operations page will surface the failure
    //    via the step_runs and instance.status.
    const triggerInput = req.body?.trigger_input;
    const newInstanceId = (result as { id?: string }).id;
    if (newInstanceId) {
      try {
        const execResult = await executeInstance(newInstanceId, triggerInput);
        res.json({ success: true, data: result, execution: execResult });
        return;
      } catch (execErr) {
        logger.error({ execErr, instanceId: newInstanceId }, 'Executor invocation failed after startInstance');
        res.json({ success: true, data: result, executionError: extractErrorMessage(execErr) });
        return;
      }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to start workflow instance');
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

// ── NEW: resume / re-run an instance (e.g. after an approval was given).
//    Idempotent — handlers know how to skip steps that already completed.
/** POST /api/v1/agents/workflows/instances/:instanceId/execute — Resume / re-run an instance. */
export const executeWorkflowInstance = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const instanceId = getParam(req, 'instanceId');
    if (!instanceId) {
      return res.status(400).json({ success: false, error: 'instanceId is required' });
    }
    const triggerInput = req.body?.trigger_input;
    const result = await executeInstance(instanceId, triggerInput);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to execute workflow instance');
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** GET /api/v1/agents/workflows/instances — List workflow instances with filters. */
export const listInstances = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const workflow_id = getQueryValue(req, 'workflow_id');
    const status      = getQueryValue(req, 'status');
    const limit       = getQueryNumber(req, 'limit', 50);
    const offset      = getQueryNumber(req, 'offset', 0);
    const result = await runtimeService.listInstances({
      workspace_id: workspaceId,
      workflow_id,
      status,
      limit,
      offset,
    });
    res.json({ success: true, data: result.instances, total: result.total });
  } catch (err) {
    logger.error({ err }, 'Failed to list instances');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/instances/:instanceId — Get a single instance by ID. */
export const getInstance = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const instanceId = getParam(req, 'instanceId');
    const instance = await runtimeService.getInstance(instanceId);
    res.json({ success: true, data: instance });
  } catch (err) {
    logger.error({ err }, 'Failed to get instance');
    next(err);
  }
};

/** PATCH /api/v1/agents/workflows/instances/:instanceId/transition — Transition instance status. */
export const transitionInstance = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const instanceId = getParam(req, 'instanceId');
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required for transition' });
    }

    const result = await runtimeService.transitionInstance(instanceId, status, reason);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to transition instance');
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** GET /api/v1/agents/workflows/instances/:instanceId/step-runs — List step runs for an instance. */
export const getInstanceStepRuns = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const instanceId = getParam(req, 'instanceId');
    const stepRuns = await runtimeService.getStepRuns(instanceId);
    res.json({ success: true, data: stepRuns });
  } catch (err) {
    logger.error({ err }, 'Failed to get step runs');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/approvals — List pending approvals for the workspace. */
export const getApprovals = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const required_role = getQueryValue(req, 'required_role');
    const limit         = getQueryNumber(req, 'limit', 50);
    const offset        = getQueryNumber(req, 'offset', 0);
    const result = await approvalService.listPendingApprovals({
      workspace_id: workspaceId,
      required_role: required_role || undefined,
      limit,
      offset,
    });
    res.json({ success: true, data: result.approvals, total: result.total });
  } catch (err) {
    logger.error({ err }, 'Failed to get approvals');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/approvals/:approvalId/decide — Record approval decision. */
export const recordApproval = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const approvalId = getParam(req, 'approvalId');
    const { decision, decision_reason, edited_output_ref, requested_changes } = req.body;

    if (!decision) {
      return res.status(400).json({ success: false, error: 'decision is required (approve | reject | request_changes)' });
    }

    const userId   = req.user?.id || 'system';
    const userName = req.user?.email || 'Unknown';
    const result = await approvalService.recordDecision({
      approvalId,
      approverId:       userId,
      approverName:     userName,
      decision,
      decisionReason:   decision_reason,
      editedOutputRef:  edited_output_ref,
      requestedChanges: requested_changes,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to record approval');
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** GET /api/v1/agents/workflows/approvals/stats — Approval statistics. */
export const getApprovalStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const stats = await approvalService.getApprovalStats(workspaceId);
    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error({ err }, 'Failed to get approval stats');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/versions/:versionId/simulate — Run a simulation on a version. */
export const runSimulation = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const { scenario_name, sample_input_ref } = req.body;
    const userId = req.user?.id || 'system';
    const workspaceId = req.user?.workspace_id;
    const result = await simulationService.runSimulation({
      workflow_version_id: versionId,
      scenario_name,
      sample_input_ref,
      created_by: userId,
      workspace_id: workspaceId || undefined,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to run simulation');
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** GET /api/v1/agents/workflows/versions/:versionId/simulations — List simulation runs for a version. */
export const listSimulations = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const simulations = await simulationService.listSimulations(versionId);
    res.json({ success: true, data: simulations });
  } catch (err) {
    logger.error({ err }, 'Failed to list simulations');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/:id/dependencies — Check dependency health for a workflow. */
export const getDependencies = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const deps = await dependencyService.checkWorkflowDependencies(id);
    res.json({ success: true, data: deps });
  } catch (err) {
    logger.error({ err }, 'Failed to get dependencies');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/instances/:instanceId/evidence — Get evidence bundle for an instance. */
export const getWorkflowEvidence = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const instanceId = getParam(req, 'instanceId');
    const bundle = await evidenceService.getWorkflowEvidence(instanceId);
    res.json({ success: true, data: bundle });
  } catch (err) {
    logger.error({ err }, 'Failed to get workflow evidence');
    next(err);
  }
};

/** POST /api/v1/agents/workflows/instances/:instanceId/evidence — Create a new evidence bundle. */
export const createEvidence = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const userId = req.user?.id || 'system';
    const userName = req.user?.email || 'Unknown';
    const { instance_id, workflow_id, version_id, bundle_type, input_snapshot, output_snapshot, policy_results, dependency_results } = req.body;

    if (!instance_id && !workflow_id) {
      return res.status(400).json({ success: false, error: 'instance_id or workflow_id is required' });
    }

    let wfid = workflow_id ? String(workflow_id) : '';
    let verid = version_id ? String(version_id) : '';
    if (!wfid && instance_id) {
      const { data: inst } = await (await import('../../shared/supabase')).supabaseAdmin.from('workflow_instances').select('workflow_id, version_id').eq('id', instance_id).maybeSingle();
      if (inst) {
        wfid = inst.workflow_id || '';
        verid = inst.version_id || '';
      }
    }

    if (!wfid) {
      return res.status(400).json({ success: false, error: 'Could not resolve workflow_id' });
    }

    const result = await evidenceService.createEvidenceBundle({
      workspace_id: workspaceId,
      workflow_id: wfid,
      version_id: verid,
      bundle_type: bundle_type || 'run',
      actor_id: userId,
      actor_name: userName,
      input_snapshot: input_snapshot || undefined,
      output_snapshot: output_snapshot || undefined,
      policy_results: policy_results || undefined,
      dependency_results: dependency_results || undefined,
      created_by: userId,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to create evidence');
    res.status(500).json({ success: false, error: extractErrorMessage(err) });
  }
};

// ─── Three-Key Approval Endpoints ─────────────────────────────

/** GET /api/v1/agents/workflows/three-key/:versionId — Get the Three-Key approval chain for a version. */
export const getThreeKeyChain = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const chain = await threeKeyService.getApprovalChain(versionId);
    res.json({ success: true, data: chain });
  } catch (err) {
    logger.error({ err }, 'Failed to get approval chain');
    const statusCode = (err as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** POST /api/v1/agents/workflows/three-key/:chainId/decide — Record a decision on a Three-Key approval key. */
export const recordThreeKeyDecision = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const chainId = getParam(req, 'chainId');
    const { approval_sequence, decision, reason } = req.body;

    if (!approval_sequence || !decision) {
      return res.status(400).json({ success: false, error: 'approval_sequence and decision are required' });
    }

    if (!['approved', 'rejected', 'changes_requested'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision must be approved, rejected, or changes_requested' });
    }

    const userId = req.user?.id || 'system';
    const userName = req.user?.email || 'Unknown';
    const userRole = req.user?.role || 'VIEWER';

    const result = await threeKeyService.recordKeyDecision({
      chainId,
      approvalSequence: approval_sequence,
      approverId: userId,
      approverName: userName,
      approverRole: userRole,
      decision,
      reason,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'Failed to record Three-Key decision');
    const statusCode = (err as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: extractErrorMessage(err) });
  }
};

/** GET /api/v1/agents/workflows/three-key/pending/list — List pending Three-Key chains for the workspace. */
export const listPendingThreeKeyChains = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    const limit = getQueryNumber(req, 'limit', 50);
    const offset = getQueryNumber(req, 'offset', 0);
    const result = await threeKeyService.listPendingChains({ workspace_id: workspaceId, limit, offset });
    res.json({ success: true, data: result.chains, total: result.total });
  } catch (err) {
    logger.error({ err }, 'Failed to list pending approval chains');
    next(err);
  }
};

/** GET /api/v1/agents/workflows/three-key/:versionId/quorum — Check activation quorum for a version. */
export const getThreeKeyQuorum = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const quorum = await threeKeyService.validateApprovalQuorum({ versionId });
    res.json({ success: true, data: quorum });
  } catch (err) {
    logger.error({ err }, 'Failed to check approval quorum');
    next(err);
  }
};

// ─── Export Endpoints ────────────────────────────────────────────────────────

/** GET /api/v1/agents/workflows/:id/export — Export full workflow as JSON (with audit log). */
export const exportWorkflow = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id || 'system';
    const userEmail = req.user?.email;
    const reason = req.query.reason as string | undefined;

    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });

    const payload = await exportService.exportWorkflowFull({
      workflowId: id,
      workspaceId,
      userId,
      userEmail,
      reason,
    });

    // Audit log — best-effort; never block the export on an audit-write failure
    // (logExportAuditEvent already raises a SecOps alert on failure).
    try {
      await exportService.logExportAuditEvent({
        workflowId: id,
        workflowName: payload.workflow.name,
        workspaceId,
        userId,
        userEmail,
        exportType: 'full_json',
        reason,
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr }, 'Export audit log failed (non-blocking)');
    }

    res.json({ success: true, data: payload });
  } catch (err: any) {
    logger.error({ err }, 'Failed to export workflow');
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (err as Error).message });
  }
};

/** GET /api/v1/agents/workflows/:id/export/approvals — Export approvals as CSV (with audit log). */
export const exportApprovals = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id || 'system';

    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });

    const csv = await exportService.exportApprovalsCsv({
      workflowId: id,
      workspaceId,
      userId,
      reason: req.query.reason as string | undefined,
    });

    // Audit log
    const { data: wf } = await (await import('../../shared/supabase')).supabaseAdmin
      .from('workflow_templates')
      .select('name')
      .eq('id', id)
      .single();

    try {
      await exportService.logExportAuditEvent({
        workflowId: id,
        workflowName: wf?.name || 'Unknown',
        workspaceId,
        userId,
        userEmail: req.user?.email,
        exportType: 'approvals_csv',
        reason: req.query.reason as string | undefined,
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr }, 'Approvals export audit log failed (non-blocking)');
    }

    res.json({ success: true, data: csv });
  } catch (err: any) {
    logger.error({ err }, 'Failed to export approvals');
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (err as Error).message });
  }
};

/** GET /api/v1/agents/workflows/export/evidence/:evidenceRef — Export evidence bundle by reference. */
export const exportEvidenceByRef = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const evidenceRef = getParam(req, 'evidenceRef');
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id || 'system';

    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });

    const payload = await exportService.exportEvidenceByRef({
      evidenceRef,
      workspaceId,
      userId,
      reason: req.query.reason as string | undefined,
    });

    // Audit log
    await exportService.logExportAuditEvent({
      workflowId: payload.workflow.id,
      workflowName: payload.workflow.name,
      workspaceId,
      userId,
      userEmail: req.user?.email,
      exportType: 'evidence_by_ref',
      reason: req.query.reason as string | undefined,
    });

    res.json({ success: true, data: payload });
  } catch (err: any) {
    logger.error({ err }, 'Failed to export evidence by ref');
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (err as Error).message });
  }
};

/** GET /api/v1/agents/workflows/:id/export/pdf-ready — Build PDF-ready payload from full export. */
export const exportPdfReady = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id || 'system';
    const userEmail = req.user?.email;

    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });

    const full = await exportService.exportWorkflowFull({
      workflowId: id,
      workspaceId,
      userId,
      userEmail,
      reason: 'pdf_ready_export',
    });

    const pdfPayload = exportService.buildPdfReadyPayload(full);

    // Audit log
    await exportService.logExportAuditEvent({
      workflowId: id,
      workflowName: full.workflow.name,
      workspaceId,
      userId,
      userEmail,
      exportType: 'pdf_ready',
      reason: 'pdf_ready_export',
    });

    res.json({ success: true, data: pdfPayload });
  } catch (err: any) {
    logger.error({ err }, 'Failed to build PDF-ready export');
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (err as Error).message });
  }
};

/** GET /api/v1/agents/workflows/:id/export/timeline — Export runtime timeline as CSV (with audit log). */
export const exportRuntimeTimeline = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id || 'system';
    const userEmail = req.user?.email;
    const reason = req.query.reason as string | undefined;

    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });

    const csv = await exportService.exportRuntimeTimelineCsv({
      workflowId: id,
      workspaceId,
      userId,
      reason,
    });

    // Audit log
    const { data: workflow } = await (await import('../../shared/supabase')).supabaseAdmin
      .from('workflow_templates')
      .select('name')
      .eq('id', id)
      .single();

    await exportService.logExportAuditEvent({
      workflowId: id,
      workflowName: workflow?.name || 'Unknown',
      workspaceId,
      userId,
      userEmail,
      exportType: 'runtime_timeline_csv',
      reason,
    });

    res.json({ success: true, data: csv });
  } catch (err: any) {
    logger.error({ err }, 'Failed to export runtime timeline');
    const statusCode = err?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (err as Error).message });
  }
};

// ─── Notification Endpoints ─────────────────────────────────────────────────

/** POST /api/v1/agents/workflows/:id/notify — Trigger a workflow notification event. */
export const triggerWorkflowNotification = async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const workspaceId = req.user?.workspace_id;
    const userId = req.user?.id || 'system';
    const { event_type, version_id, channels, metadata } = req.body;

    if (!workspaceId) return res.status(403).json({ error: 'Workspace not found' });
    if (!event_type) return res.status(400).json({ success: false, error: 'event_type is required' });

    // Resolve workflow name
    const { data: workflow } = await (await import('../../shared/supabase')).supabaseAdmin
      .from('workflow_templates')
      .select('name')
      .eq('id', id)
      .single();

    const events = await notificationService.createWorkflowNotification({
      eventType: event_type,
      workflowId: id,
      workflowName: workflow?.name || 'Unknown',
      versionId: version_id,
      channels: channels || ['in_app'],
      recipientUserIds: [userId],
      metadata: metadata || {},
    });

    res.json({ success: true, data: events });
  } catch (err: any) {
    logger.error({ err }, 'Failed to trigger workflow notification');
    res.status(500).json({ success: false, error: (err as Error).message });
  }
};

// ─────────────────────────────────────────────────────────────────
// Phase 7 — Interactive Canvas Editor: Save graph / update step config
// ─────────────────────────────────────────────────────────────────

/** POST /api/v1/agents/workflows/versions/:versionId/graph — Save full graph (nodes + edges) for canvas editor. */
export const saveWorkflowGraph = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const versionId = getParam(req, 'versionId');
    const { nodes, edges } = req.body;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ success: false, error: 'nodes and edges arrays are required' });
    }

    const { supabaseAdmin } = await import('../../shared/supabase');

    // Delete existing steps and edges for this version
    const [delSteps, delEdges] = await Promise.all([
      supabaseAdmin.from('workflow_steps').delete().eq('version_id', versionId),
      supabaseAdmin.from('workflow_edges').delete().eq('version_id', versionId),
    ]);
    if (delSteps.error) throw delSteps.error;
    if (delEdges.error) throw delEdges.error;

    // Insert steps with sequence order preserved
    const stepsToInsert = (nodes || []).map((node: any, index: number) => ({
      id: node.id,
      version_id: versionId,
      sequence: index + 1,
      step_type: node.type || 'action',
      name: node.label || node.name || `Step ${index + 1}`,
      description: node.description || null,
      owner_role: node.owner_role || null,
      sla_minutes: node.sla_minutes ?? null,
      conditions: node.conditions || null,
      agent_id: node.agent_id || null,
      prompt_id: node.prompt_id || null,
      prompt_version: node.prompt_version || null,
      knowledge_scope: node.knowledge_scope || null,
      policy_pack: node.policy_pack || null,
      reviewer_role: node.reviewer_role || null,
      approval_type: node.approval_type || null,
      quorum: node.quorum ?? null,
      channel: node.channel || null,
      escalation_reason: node.escalation_reason || null,
      escalation_rule: node.escalation_rule || null,
      target_role: node.target_role || null,
      severity: node.severity || null,
      duration: node.duration || null,
      completion_status: node.completion_status || null,
      fallback_owner: node.fallback_owner || null,
      required_evidence: node.required_evidence ?? null,
      required_policy_checks: node.required_policy_checks || null,
      input_schema: node.input_schema || null,
      output_schema: node.output_schema || null,
      x: Math.round(node.x || 0),
      y: Math.round(node.y || 0),
    }));

    // Insert in batches of 50
    for (let i = 0; i < stepsToInsert.length; i += 50) {
      const batch = stepsToInsert.slice(i, i + 50);
      const { error: insErr } = await supabaseAdmin.from('workflow_steps').insert(batch);
      if (insErr) throw insErr;
    }

    // Insert edges
    const edgesToInsert = (edges || []).map((edge: any) => ({
      id: edge.id,
      version_id: versionId,
      from_step_id: edge.source,
      to_step_id: edge.target,
      branch_label: edge.label || null,
      condition: edge.condition || null,
      default_path: edge.default_path ?? null,
      fail_safe_path: edge.fail_safe_path ?? null,
    }));

    for (let i = 0; i < edgesToInsert.length; i += 50) {
      const batch = edgesToInsert.slice(i, i + 50);
      const { error: insErr } = await supabaseAdmin.from('workflow_edges').insert(batch);
      if (insErr) throw insErr;
    }

    res.json({
      success: true,
      data: { nodes: nodes.length, edges: edges.length, version_id: versionId },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save workflow graph');
    next(err);
  }
};

/** PATCH /api/v1/agents/workflows/steps/:stepId — Update a single step configuration. */
export const saveWorkflowStepConfig = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stepId = getParam(req, 'stepId');
    const updates = req.body;
    delete updates.id;
    delete updates.version_id;

    const { supabaseAdmin } = await import('../../shared/supabase');
    const { error } = await supabaseAdmin.from('workflow_steps').update(updates).eq('id', stepId);
    if (error) throw error;

    res.json({ success: true, data: { id: stepId } });
  } catch (err) {
    logger.error({ err }, 'Failed to save step config');
    next(err);
  }
};