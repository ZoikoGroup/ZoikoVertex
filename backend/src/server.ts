import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import os from 'os';
import { env } from './config/env';
import { logger } from './shared/logger';
import { errorHandler } from './shared/errorHandler';

// Controllers
import { provisionUser, resendVerificationEmail } from './domains/identity/identityController';
import { generateContent, generateAdCopy, analyzeImage } from './domains/intelligence/intelligenceController';
import { transitionStatus, submitIntent, deleteIntent, listIntents, getQueue, reviewActionIntent } from './domains/governance/governanceController';
import {
  getAuditTrail, getAuditStats, 
  getEvidenceArtifacts, getEvidenceArtifactDetail, getEvidenceStats,
  applyLegalHold, listLegalHolds, releaseLegalHold,
  buildEvidencePack, listEvidencePacks, downloadEvidencePack
} from './domains/governance/evidenceController';
import {
  getEvents as getAuditEvents,
  getEventsStats as getAuditEventsStats,
  getEventDetail,
  getEventRelated,
  verifyChain,
  createExport,
  listExports,
  preserve,
  sealExpired,
  createInvestigation,
  createEvent,
  getEventDiffHandler,
  getCorrelationTimelineHandler,
  getEventClustersHandler,
} from './domains/evidence/auditTrailController';
import {
  subscribeSSE,
  createWebhookSubscription,
  listSubscriptionsRoute,
  deleteSubscriptionRoute,
  testSubscription,
  getSubscriptionById,
  updateSubscriptionRoute,
} from './domains/evidence/auditTrailStreamingController';
import { getRiskPulse, getActiveRiskFeed, getGovernanceGaps, triggerEmergencyPause } from './domains/governance/riskController';
import { getSafetyOverview, getSafetyComponents, getSafetyQueueSummary, getSafetyRecentDecisions, reviewCriticalQueue, requestEmergencyPause } from './domains/governance/safetyController';
import { getSafetySignals, getSafetySignalDetail, createManualSignal, classifySafetySignal, routeSafetySignal, mergeSafetySignals, splitSafetySignal, closeSafetySignal, getSafetyActionsHistory } from './domains/governance/signalsController';
import { getPolicySummary, getPolicies, createPolicy, simulatePolicy, getEnforcementEvents } from './domains/governance/policyController';
import { getReviewQueue, getReviewDetail, submitReviewDecision } from './domains/governance/reviewController';
import { getForensicSummary, getAgentPerformance } from './domains/governance/forensicController';
import {
  listCases as listForensicCases,
  createCase as createForensicCase,
  getStats as getForensicStats,
  getCase as getForensicCase,
  updateCase as updateForensicCase,
  assignCase,
  addEvidence,
  listEvidence,
  pinEvidence,
  addNote,
  listNotes,
  addTask,
  updateTask,
  listTasks,
  listActions,
  getTimeline,
  closeCase,
  reopenCase,
  preserveToVault,
  applyLegalHold as applyForensicLegalHold,
  releaseLegalHold as releaseForensicLegalHold,
  getSlaReport,
  getEntityGraph,
  createExport as createForensicExport,
  listExports as listForensicExports,
  approveExport,
  rejectExport,
  generateExport,
  markEvidencePrivileged,
  unpinEvidence,
} from './domains/evidence/forensicHubController';
import {
  generateAiSummary,
  approveAiSummary as approveSummary,
  rejectAiSummary as rejectSummary,
  listAiSummaries,
  generateTimelineExplanation,
  detectAnomalies,
  listAnomalies,
  generateRecommendations,
  routeToSiem,
  getSiemHistory,
  createAuditorSession,
  getExportNarrative,
} from './domains/evidence/forensicPhase4Controller';
import {
  listEvidenceItems as listVaultEvidenceItems,
  getEvidenceItem,
  preserveEvidence,
  verifyEvidenceItem as verifyVaultEvidenceItem,
  createCollection,
  listCollections,
  getCollection,
  addItemsToCollection,
  getCollectionItems as getVaultCollectionItems,
  getVaultHealth,
  // Phase 2
  createPackage,
  listPackages as listVaultPackages,
  getPackage as getVaultPackage,
  sealPackage as sealVaultPackage,
  getPackageManifest as getVaultPackageManifest,
  verifyPackage as verifyVaultPackage,
  createExport as createVaultExport,
  listExports as listVaultExports,
  getExportReceipt,
  applyHold,
  listHolds as listVaultHolds,
  releaseHold,
  deleteHold as deleteVaultHold,
  createRedactionPolicy,
  listRedactionPolicies,
  // Phase 3
  createShare,
  listShares as listVaultShares,
  getShare as getVaultShare,
  revokeShare,
  getShareAccessLogs,
  runDlpScan,
  getDlpScan,
  listDlpScans,
  // Phase 4
  createAsyncJob,
  listAsyncJobs as listVaultAsyncJobs,
  getAsyncJob,
  createChainAnchor,
  listChainAnchors,
  verifyChainAnchor,
  createTemplateVersion,
  listTemplateVersions,
} from './domains/evidence/evidenceVaultController';
import {
  listLedgerEntries as listIdentityLedgerEntries,
  listActors as listIdentityActors,
  getActor as getIdentityActor,
  getActorTimeline as getIdentityActorTimeline,
  getAuthoritySnapshot as getIdentityAuthoritySnapshot,
  getAuthorityAtEvent as getIdentityAuthorityAtEvent,
  verifyLedgerChain as verifyIdentityLedgerChain,
  listDelegations,
  createDelegation,
  revokeDelegation,
  listBreakGlass,
  requestBreakGlass,
  activateBreakGlass,
  endBreakGlass,
  reviewBreakGlass,
  exportLedger,
  preserveToVault as identityLedgerPreserveToVault,
  registerServiceAccount,
  listServiceAccounts,
  revokeServiceAccount,
  getActorTimelineWithSessions,
  evaluateActorRiskFlags,
  setActorRiskFlags
} from './domains/evidence/identityLedgerController';
import {
  routeToModule,
  executeChain,
  listRoutingHistory,
  listWorkflowChains,
} from './domains/governance/routingController';
import { getCollusionMetrics } from './domains/governance/collusionController';
import { getBrandProfiles, createBrandProfile, getLinguisticProfile, getClaimsLedger, updateBrandRule } from './domains/governance/brandController';
import { handleFacebookCallback, handleLinkedInCallback, handlePinterestCallback, handleThreadsCallback, handleThreadsDeauthorize, handleThreadsDataDeletion, handleTwitterCallback, handleYoutubeCallback, handleGoogleAdsCallback, disconnectAccount, getLinkedInPagesSession, saveLinkedInPages, generateOAuthNonce, initTwitterOAuth } from './domains/channels/socialController';
import { getRecommendations, schedulePost, cancelScheduledPost, listScheduledPosts, updateScheduledPost, getScheduledPost, getSchedulerHealth, getBestSlot } from './domains/campaigns/schedulerController';
import { listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, getCampaignPosts, bulkAssignPixel } from './domains/campaigns/campaignsController';
import { getCampaignStats, submitCampaignForReview, approveCampaign, checkLaunchGate, launchCampaign, pauseCampaign, resumeCampaign, emergencyPauseCampaign, getCampaignEvents, updateSpend } from './domains/campaigns/campaignsV2Controller';
import { requestBudgetAuth, getBudgetAuthForCampaign, listBudgetAuths, approveBudgetAuth, rejectBudgetAuth } from './domains/campaigns/budgetAuthController';
import { getMetaAdAccounts, linkAdAccount, createBoost, listBoosts, syncBoostMetrics, pauseBoost, resumeBoost, cancelBoost, getCampaignInsights, getCampaignBreakdownInsights, getCampaignTrend, getCampaignAdInsights, syncBudgetToMeta, pushCampaignToMetaHandler } from './domains/campaigns/adsController';
import { getGoogleAdsCustomers, linkGoogleAdsCustomer, createGoogleBoost, syncGoogleBoostMetrics as syncGoogleMetrics, pauseGoogleBoost, resumeGoogleBoost, cancelGoogleBoost } from './domains/campaigns/googleAdsController';
import { listLibrary, addToLibrary, deleteFromLibrary, listStorageItems, bulkDeleteFromLibrary, scanMediaUrl } from './domains/content/libraryController';
import { readRecentScans } from './modules/safety/scanLogger';
import {
  listAgents, getAgent, registerAgent, certifyAgent, updateAutonomy,
  getAgentCapabilities, getAgentVersions, rollbackAgent,
  runAgentSandbox, getAgentTestHistory,
  getAgentLinkedResources, updateLinkedResources,
  getChecklist, getAgentEvidence, getEvidence,
  cloneAgent, deployAgent, pauseAgent, resumeAgent, retireAgent, hardDeleteAgent, requestApproval,
  approveAgent, rejectAgentApproval, updateRuntimeControls,
  updateAgent, listAgentTemplates, getAgentTemplate, createAgentFromTemplate,
  getAgentProfile, getAgentGovernanceGates,
  getAgentPermissionSets, updateAgentPermissionSets,
  runAgentSafetyChecks, getAgentSafetyResults,
  runAgentPlatformChecks, getAgentPlatformCheckHistory,
  getAgentIncidents, createAgentIncident, resolveAgentIncident
} from './domains/agents/agentController';
import {
  getAutonomyStats, updateAgentLevel, suspendAgent,
  createEmergencyLock, listEmergencyLocks, liftEmergencyLock,
  listHITLRules, upsertHITLRule, deleteHITLRule,
  listNegativeKnowledge, createNegativeKnowledge, deleteNegativeKnowledge,
} from './domains/agents/autonomyController';
import { SuperAdminController } from './domains/admin/superAdminController';
import { SupportController } from './domains/admin/supportController';
import { getUserContext } from './domains/identity/userController';
import { changePlan } from './domains/identity/planController';
import { listAccounts } from './domains/channels/accountsController';
import { getPlatformReach } from './domains/channels/platformInsightsController';
import { getLinkedInPageFeed, getLinkedInPageAnalytics, getLinkedInPostComments, replyToLinkedInPost, deleteLinkedInComment } from './domains/channels/linkedinCommunityController';
import { listMembers, listRequests, createRequest, updateRequest, deleteMember, updateMemberRole } from './domains/identity/teamController';
import {
  listUnits, getUnit, getUnitStats, getUnitChildren, createUnit, updateUnit, archiveUnit, deleteUnit, restoreUnit,
  getUnitMembers, addUnitMember, removeUnitMember,
  getUnitBrands, linkUnitBrand, unlinkUnitBrand,
  getUnitActivity,
  getUnitEvidenceScope, setUnitEvidenceScope, deleteUnitEvidenceScope,
  getAvailableMembers,
} from './domains/identity/unitsController';
import { performQualityCheck, listAuditItems, getAuditItem, getQaAuditStats, getAuditEligibility, getQaAuditTrail, startAudit, passAudit, failAudit, needsCorrection, escalateAudit, closeAudit, assignAuditorToItem, saveScorecard, overrideScorecard, addDefect, resolveDefect, addCorrectiveAction, updateCorrectiveAction,   addQaNote, addQaEvidence, generateSample, retryQaCallback, retryQaCallbackByItem, exportQaFindings, exportQaEvidence, getAuditDefects, getAuditCorrectiveActions, getAuditNotes, getAuditEvidence } from './domains/governance/qaController';
import {
  createException, listExceptions, getException, updateException,
  getExceptionStats, assignOwner, updateSeverity, updateStatus,
  addBlocker, getBlockers, addRemediation, completeRemediation, getRemediations,
  escalateException, requestOverride, decideOverride,
  addEvidence as addExceptionEvidence, getEvidence as getExceptionEvidence,
  resolveException as resolveExceptionV2,
  sendToValidation, sendToApprovals as sendExceptionToApprovals, sendToQualityAudit,
  getAuditTrail as getExceptionAuditTrail,
  exportExceptionRecord, closeExceptionCase, archiveExceptionCase, bulkExceptionAction,
} from './domains/governance/exceptionV2Controller';
import { listItems as listReviewItems, getItem as getReviewItem, takeAction as takeReviewAction, getStats as getReviewStats, getEligibility as getReviewEligibility, getAuditLog as getReviewAuditLog, createItem as createReviewItem, getReviewValidation, getReviewPolicyFlags, getReviewNotesHandler, getReviewRevisionHistory, assignReviewItemHandler, addReviewNoteHandler, bulkReviewAction } from './domains/governance/reviewQueueController';
import {   createValidationItem, listValidationItems, getValidationItem, assignValidator, runValidation, revalidateItem, getValidationRunResults, requestRevision, sendToReviewQueue, sendToApprovals, escalateValidation, applyOverride, blockItem, completeManualCheck, addValidatorNote, getValidationAuditTrail, getValidationStats, getValidationEligibility, retryValidationCallback, exportValidationRecord, getValidationRuns, getValidationGrounding, getValidationNotesList, getValidationManualChecks, getValidationApprovalReadiness, getValidationRuleHistory, returnToCreator } from './domains/governance/validationController';
import {
  KnowledgeController,
} from './modules/knowledge/knowledgeController';
import { PromptController } from './modules/prompts/promptController';
import { getResourceUsage, getTokenQuota, getStorageQuota, purchaseStorageAddon } from './domains/monitoring/usageController';
import {
  getWalletData, updateAutoTopup, calculateFees, createDepositSession, stripeWebhook, simulateDeposit, syncDepositSession,
  startTrial, getBillingStatus,
  getSpendCap, updateSpendCap, getBillingSettings, updateBillingSettings,
  createSetupIntent, createSetupCheckout, syncCardSession, listPaymentMethods, deletePaymentMethod, setDefaultPaymentMethod,
  getWalletBalance, createSubscription, cancelSubscription, getSubscription, listInvoices,
  getOvercharge, updateOvercharge,
} from './domains/billing/walletController';
import { requireBillingExecution } from './shared/billingGate';
import { getSystemTelemetry, getMissionLogs } from './domains/monitoring/telemetryController';
import { performGlobalSearch } from './domains/admin/globalSearchController';
import { getIntegrationHealth } from './domains/monitoring/integrationHealthController';
import { enterpriseSignup } from './domains/identity/enterpriseSignupController';
import {
  submitDemoRequest, submitContactSales, submitAuditRequest,
  submitDemoLibraryRequest, submitResourceRequest, submitPrivacyRequest,
  submitCookieConsent,
} from './domains/identity/websiteLeadController';
import { setupWorkspace, completeOnboarding } from './domains/identity/onboardingController';
import { sendOtpCode, verifyOtpCode, resendOtpCode } from './modules/auth/otpController';
import { getWorkspaceSettings, updateWorkspaceSettings, exportWorkspaceData } from './domains/admin/workspaceController';
import { getRetentionSettings, updateRetentionSettings, triggerRetentionRun, getRetentionLogs } from './domains/admin/retentionController';
import { getSidebarCounts } from './domains/sidebar/sidebarController';
import { listDrafts as listDraftPosts, getDraft as getDraftPost, saveDraft as saveDraftPost, updateDraft as updateDraftPost, deleteDraft as deleteDraftPost, getDraftCount } from "./domains/agents/draftsController";
import { getCalendarEvents } from './domains/calendar/calendarController';
// New features from Naresh
import { listNotifications, markAsRead, markAllRead, clearNotifications, deleteNotification } from './domains/identity/notificationController';
import {
  exportWorkflow,
  exportApprovals,
  exportEvidenceByRef,
  exportPdfReady,
  exportRuntimeTimeline,
  triggerWorkflowNotification,
} from './domains/agents/workflowController';
import { listRules, createRule, getRule, deleteRule, updateRule, submitRuleForReview, publishRule, deactivateRule, reactivateRule, archiveRule, cloneRule, getRuleScope, upsertRuleScope, getRulePath, upsertRulePath, getRuleVersions, getRuleAuditLog, getRuleConflicts, detectRuleConflicts, resolveRuleConflict, runRuleSimulation, getRuleStats, getRuleDetails, getRuleStagesHandler, getRuleEscalationsHandler, markRuleReadyToPublish, markRuleInvalid, suggestKeywords } from './domains/governance/ruleController';
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  duplicateWorkflow,
  deleteWorkflow,
  listVersions,
  createDraftVersion,
  submitForApproval,
  approveVersion,
  rejectVersion,
  activateVersion,
  rollbackVersion,
  pauseWorkflow,
  retireWorkflow,
  getWorkflowGraph,
  getWorkflowGraphGeneral,
  validateReadiness,
  getActiveOrchestrations,
  getPublishedContent,
  getPublishedContentMeta,
  deletePublishedContentItem,
  getWorkflowStats,
  getWorkflowAnalytics,
  getControlStrip,
  getEscalationPaths,
  startWorkflowInstance,
  executeWorkflowInstance,
  listInstances,
  getInstance,
  transitionInstance,
  getInstanceStepRuns,
  getApprovals,
  recordApproval,
  getApprovalStats,
  runSimulation,
  listSimulations,
  getDependencies,
  getWorkflowEvidence,
  createEvidence,
  getThreeKeyChain,
  recordThreeKeyDecision,
  listPendingThreeKeyChains,
  getThreeKeyQuorum,
  saveWorkflowGraph,
  saveWorkflowStepConfig
} from './domains/agents/workflowController';
import {
  getPerformanceSummary,
  getPerformanceTrends,
  getHallucinationFlags,
  getAgentLeaderboard
} from './domains/monitoring/modelPerformanceController';

import { submitForReview, getApprovalQueue, getApprovalStats as getApprovalStatsLegacy, takeApprovalAction } from './domains/decisions/approvalController';
import {
  createApprovalItem, listApprovalItems, getApprovalItem as getV2ApprovalItem,
  takeApprovalAction as takeV2ApprovalAction, assignApprover, reassignApprover,
  getApprovalStats as getV2ApprovalStats, getApprovalEligibility,
  getApprovalPath, createApprovalPathHandler, getApprovalDecisions, getApprovalComments, addApprovalComment,
  getApprovalEvidence, addApprovalEvidence, getApprovalAuditTrail,
  exportApprovalRecord, retryCallback, bulkApprovalAction,
} from './domains/decisions/approvalV2Controller';
import { authenticate, provisionGuard, scopeGuard } from './shared/authMiddleware';
import { integrationPlanGate, blockApiKeyUsers, planRateLimit } from './shared/planLimits';
import { requireRole } from './shared/permissionMiddleware';
import { registerExecutionListeners } from './domains/channels/executionService';
import { registerEventBridge } from './services/eventBridge';
import {
  listApiKeys, createApiKey, revokeApiKey, deleteApiKey,
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook, getDeliveryLogs,
} from './domains/integrations/apiWebhookController';
import {
  listConnectors, createConnector, deleteConnector, getSyncLogs, triggerSync
} from './domains/integrations/dataConnectorController';
import {
  listAgentRuns,
  getAgentRun,
  getRunTimeline,
  pauseRun,
  resumeRun,
  startRun,
  deleteRun,
  stopRun,
  retryRun,
  quarantineRun,
  listQueues,
  assignQueueItem,
  resolveQueueItem,
  createIncident,
  listIncidents,
  resolveIncident,
  generatePostmortem,
  getPostmortem,
  getOperationsStats,
  getRunEvidence,
  exportEvidence,
  emergencyPause,
  escalateRun,
  restrictedMode,
  holdRun,
  releaseHoldRun,
  runPolicyCheck,
  getPolicyResults,
  getRuntimeControlLog,
  getAnalyticsMetrics,
  exportAnalyticsCSV,
  exportOutputSnapshot,
  createEvidenceBundle,
  lockEvidenceBundle,
  listEvidenceBundles,
  subscribeOperationsEvents
} from './domains/agents/operationsController';
import { requireOperationsAccess } from './services/operationsAuthorization.service';

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });
const app = express();
const port = env.PORT;

// Guard: replace any undefined route handler with a 501 stub so the server
// starts even when some controller exports are not yet implemented.
(function patchUndefinedHandlers(a: express.Express) {
  const stub = (path: string) => (_req: express.Request, res: express.Response) =>
    res.status(501).json({ error: `Route ${path} not yet implemented` });
  for (const m of ['get','post','put','patch','delete'] as const) {
    const orig = (a as any)[m].bind(a);
    (a as any)[m] = (path: string, ...handlers: any[]) =>
      orig(path, ...handlers.map(h => (typeof h === 'function' ? h : stub(path))));
  }
})(app);

// Middleware
app.use(compression());
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
const ALLOWED_ORIGINS = [
  env.FRONTEND_URL,
  'https://getzoikovertex.com',
  'https://www.getzoikovertex.com',
  // Marketing site (landing forms: request-demo, contact-sales, audit, demo-library…)
  'https://zoikovertex.com',
  'https://www.zoikovertex.com',
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no origin header)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      const err = new Error(`CORS: origin ${origin} not allowed`) as Error & { statusCode?: number };
      err.statusCode = 403;
      callback(err);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-workspace-id'],
  credentials: true,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Reusable private cache helper — applies Cache-Control to stable authenticated routes
const cache = (maxAge: number) => (_req: any, res: any, next: any) => {
  res.set('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
  next();
};

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'ZoikoVertex Control Plane API is active.',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── IP-based rate limiter for auth endpoints ────────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (entry.resetAt < now) rateLimitStore.delete(ip);
  }
}, 60000); // ponytail: global cleanup every 60s, per-IP sliding window
const authRateLimit = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitStore.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + 60000 };
    rateLimitStore.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 20) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
};

// ─── Routes ──────────────────────────────────────────────────────────────────
app.post('/api/v1/auth/signup-enterprise', authRateLimit, enterpriseSignup);
app.post('/api/v1/auth/otp/send', authRateLimit, sendOtpCode);
app.post('/api/v1/auth/otp/verify', authRateLimit, verifyOtpCode);
app.post('/api/v1/auth/otp/resend', authRateLimit, resendOtpCode);
app.post('/api/v1/onboarding/setup', authenticate, setupWorkspace);
app.post('/api/v1/onboarding/complete', authenticate, completeOnboarding);
app.post('/api/v1/users/provision', provisionGuard, provisionUser);
app.post('/api/v1/users/resend-verification', authenticate, resendVerificationEmail);

// ─── Public marketing-site form endpoints (no auth; IP rate-limited) ─────────
// Backing the landing-site forms: /request-demo, /contact-sales, /about (48-hr
// audit), /demo-library, /resources-hub (toolkit gate), /privacy (DSAR intake).
app.post('/api/v1/website/leads/demo',          authRateLimit, submitDemoRequest);
app.post('/api/v1/website/leads/contact-sales', authRateLimit, submitContactSales);
app.post('/api/v1/website/leads/audit',         authRateLimit, submitAuditRequest);
app.post('/api/v1/website/leads/demo-library',  authRateLimit, submitDemoLibraryRequest);
app.post('/api/v1/website/leads/resource',      authRateLimit, submitResourceRequest);
app.post('/api/v1/website/leads/privacy',       authRateLimit, submitPrivacyRequest);
// Cookie consent evidence (item 13) — records Save Preference / Accept All / Reject Non-Essential
app.post('/api/v1/website/cookie-consent',      authRateLimit, submitCookieConsent);

// Protected Intelligence/AI
const acctView = requireRole('ADMIN', 'GOVERNANCE_ADMIN', 'WORKSPACE_OWNER', 'COMPLIANCE_REVIEWER', 'REVIEWER', 'SECURITY_ADMIN');
const acctWrite = requireRole('ADMIN', 'GOVERNANCE_ADMIN', 'WORKSPACE_OWNER', 'SECURITY_ADMIN');

// ─── Feature-level RBAC Guards (aligned to sidebar access spec) ─────────────
const calendarGuard          = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','CAMPAIGN_MANAGER','CREATOR','PUBLISHER','VIEWER');
const publishHubGuard        = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','CAMPAIGN_MANAGER','CREATOR','PUBLISHER');
const reviewQueueReadGuard   = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','MANAGER','REVIEWER','VALIDATOR','APPROVER','BRAND_REVIEWER','COMPLIANCE_REVIEWER');
const reviewQueueActionGuard = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','MANAGER','REVIEWER','VALIDATOR','APPROVER','BRAND_REVIEWER','COMPLIANCE_REVIEWER');
const validationDeskGuard    = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','VALIDATOR','APPROVER');
const approvalConsoleGuard   = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','APPROVER','COMPLIANCE_REVIEWER');
const safetyGuard            = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','BRAND_REVIEWER','COMPLIANCE_REVIEWER','SECURITY_ADMIN');
const auditTrailGuard        = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','GOVERNANCE_ADMIN','KNOWLEDGE_MANAGER','VALIDATOR','COMPLIANCE_REVIEWER','AUDITOR');
const accountsGuard          = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','DEVELOPER');
const forensicHubGuard       = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','COMPLIANCE_REVIEWER','AUDITOR','SECURITY_ADMIN');
const evidenceVaultGuard     = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','COMPLIANCE_REVIEWER','AUDITOR');
const identityLedgerGuard    = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','COMPLIANCE_REVIEWER','AUDITOR','SECURITY_ADMIN');
const knowledgeBaseGuard     = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','GOVERNANCE_ADMIN','KNOWLEDGE_MANAGER');
const agentReadGuard         = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','KNOWLEDGE_MANAGER','AGENT_ARCHITECT','AGENT_OPERATOR');
const agentStudioGuard       = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','AGENT_ARCHITECT');
const agentOpsGuard          = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','AGENT_OPERATOR');
const promptsGuard           = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','GOVERNANCE_ADMIN','AGENT_ARCHITECT');
const govRulesGuard          = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','GOVERNANCE_ADMIN');
const teamMgmtGuard          = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','SECURITY_ADMIN');
// ZV-COM-BILL-001 §22 — Billing Admin is the canonical financial role; all other
// roles (Governance Admin, Approver, Publisher, Auditor, External Collaborator)
// have no payment authority.
const billingGuard           = requireRole('SUPERADMIN','WORKSPACE_OWNER','BILLING_ADMIN');
const developerGuard         = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','DEVELOPER');
const systemStatusGuard      = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','SECURITY_ADMIN','DEVELOPER');
const privacyDataGuard       = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','PRIVACY_ADMIN');
const newInboxGuard          = requireRole('SUPERADMIN','WORKSPACE_OWNER','ADMIN','PUBLISHER');

app.post('/api/v1/ai/generate', authenticate, planRateLimit('ai'), scopeGuard('write:content', '*'), generateContent);
app.post('/api/v1/ai/generate-ad-copy', authenticate, planRateLimit('ai'), scopeGuard('write:content', '*'), generateAdCopy);
app.post('/api/v1/ai/analyze-image', authenticate, planRateLimit('ai'), scopeGuard('write:content', '*'), analyzeImage);
app.post('/api/v1/qa/check', authenticate, planRateLimit('ai'), scopeGuard('write:content', '*'), performQualityCheck);
// ─── Exception Routes (v2 — Full wireframe) ────────────────────────────
app.get('/api/v1/exceptions/cases', authenticate, acctView, scopeGuard('read:governance', '*'), listExceptions);
app.post('/api/v1/exceptions/cases', authenticate, acctWrite, scopeGuard('write:governance', '*'), createException);
app.get('/api/v1/exceptions/cases/:id', authenticate, acctView, scopeGuard('read:governance', '*'), getException);
app.patch('/api/v1/exceptions/cases/:id', authenticate, acctWrite, scopeGuard('write:governance', '*'), updateException);
app.get('/api/v1/exceptions/stats', authenticate, acctView, scopeGuard('read:governance', '*'), getExceptionStats);
app.patch('/api/v1/exceptions/cases/:id/assign', authenticate, acctWrite, scopeGuard('write:governance', '*'), assignOwner);
app.patch('/api/v1/exceptions/cases/:id/severity', authenticate, acctWrite, scopeGuard('write:governance', '*'), updateSeverity);
app.patch('/api/v1/exceptions/cases/:id/status', authenticate, acctWrite, scopeGuard('write:governance', '*'), updateStatus);
app.get('/api/v1/exceptions/cases/:id/blockers', authenticate, acctView, scopeGuard('read:governance', '*'), getBlockers);
app.post('/api/v1/exceptions/cases/:id/blockers', authenticate, acctWrite, scopeGuard('write:governance', '*'), addBlocker);
app.get('/api/v1/exceptions/cases/:id/remediations', authenticate, acctView, scopeGuard('read:governance', '*'), getRemediations);
app.post('/api/v1/exceptions/cases/:id/remediations', authenticate, acctWrite, scopeGuard('write:governance', '*'), addRemediation);
app.post('/api/v1/exceptions/remediations/:remediationId/complete', authenticate, acctWrite, scopeGuard('write:governance', '*'), completeRemediation);
app.post('/api/v1/exceptions/cases/:id/escalate', authenticate, acctWrite, scopeGuard('write:governance', '*'), escalateException);
app.post('/api/v1/exceptions/cases/:id/override-request', authenticate, acctWrite, scopeGuard('write:governance', '*'), requestOverride);
app.post('/api/v1/exceptions/overrides/:overrideId/decide', authenticate, acctWrite, scopeGuard('write:governance', '*'), decideOverride);
app.post('/api/v1/exceptions/cases/:id/evidence', authenticate, acctWrite, scopeGuard('write:governance', '*'), addExceptionEvidence);
app.get('/api/v1/exceptions/cases/:id/evidence', authenticate, acctView, scopeGuard('read:governance', '*'), getExceptionEvidence);
app.post('/api/v1/exceptions/cases/:id/resolve', authenticate, acctWrite, scopeGuard('write:governance', '*'), resolveExceptionV2);
app.post('/api/v1/exceptions/cases/:id/close', authenticate, acctWrite, scopeGuard('write:governance', '*'), closeExceptionCase);
app.post('/api/v1/exceptions/cases/:id/archive', authenticate, acctWrite, scopeGuard('write:governance', '*'), archiveExceptionCase);
app.post('/api/v1/exceptions/cases/:id/send-to-validation', authenticate, acctWrite, scopeGuard('write:governance', '*'), sendToValidation);
app.post('/api/v1/exceptions/cases/:id/send-to-approvals', authenticate, acctWrite, scopeGuard('write:governance', '*'), sendExceptionToApprovals);
app.post('/api/v1/exceptions/cases/:id/send-to-quality-audit', authenticate, acctWrite, scopeGuard('write:governance', '*'), sendToQualityAudit);
app.get('/api/v1/exceptions/cases/:id/audit-log', authenticate, acctView, scopeGuard('read:governance', '*'), getExceptionAuditTrail);
app.post('/api/v1/exceptions/cases/:id/export', authenticate, acctView, scopeGuard('read:governance', '*'), exportExceptionRecord);
app.post('/api/v1/exceptions/bulk', authenticate, acctWrite, scopeGuard('write:governance', '*'), bulkExceptionAction);

// ─── Cross-Module Automated Routing ──────────────────────────────────────────
app.get('/api/v1/routing/chains', authenticate, agentReadGuard, scopeGuard('read:governance', '*'), listWorkflowChains);
app.post('/api/v1/routing/route', authenticate, agentOpsGuard, scopeGuard('write:governance', '*'), routeToModule);
app.post('/api/v1/routing/chain', authenticate, agentOpsGuard, scopeGuard('write:governance', '*'), executeChain);
app.get('/api/v1/routing/history', authenticate, agentReadGuard, scopeGuard('read:governance', '*'), listRoutingHistory);

const govGuard = requireRole('ADMIN', 'GOVERNANCE_ADMIN', 'WORKSPACE_OWNER');
// Protected Governance
app.post('/api/v1/governance/transition', authenticate, publishHubGuard, requireBillingExecution('publish'), planRateLimit('general'), scopeGuard('write:content', '*'), transitionStatus);
app.post('/api/v1/governance/submit', authenticate, publishHubGuard, requireBillingExecution('publish'), planRateLimit('general'), scopeGuard('write:content', 'write:publish', '*'), submitIntent);
app.get('/api/v1/governance/intents', authenticate, publishHubGuard, planRateLimit('general'), scopeGuard('read:content', '*'), listIntents);
app.get('/api/v1/governance/queue', authenticate, reviewQueueReadGuard, planRateLimit('general'), scopeGuard('read:content', 'read:governance', '*'), getQueue);
app.delete('/api/v1/governance/intents/:id', authenticate, publishHubGuard, planRateLimit('general'), scopeGuard('write:content', '*'), deleteIntent);
app.post('/api/v1/governance/intents/:id/review-action', authenticate, reviewQueueActionGuard, planRateLimit('general'), scopeGuard('write:content', 'write:publish', '*'), reviewActionIntent);

// Protected Evidence Vault & Audit Trail
app.get('/api/v1/governance/audit/trail', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getAuditTrail);
app.get('/api/v1/governance/audit/stats', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getAuditStats);
app.get('/api/v1/governance/evidence/stats', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEvidenceStats);
app.get('/api/v1/governance/evidence/artifacts', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEvidenceArtifacts);
app.get('/api/v1/governance/evidence/artifacts/:id', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEvidenceArtifactDetail);
app.get('/api/v1/governance/evidence/holds', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), listLegalHolds);
app.post('/api/v1/governance/evidence/holds', authenticate, govGuard, scopeGuard('write:governance', '*'), applyLegalHold);
app.delete('/api/v1/governance/evidence/holds/:id', authenticate, govGuard, scopeGuard('write:governance', '*'), releaseLegalHold);
app.get('/api/v1/governance/evidence/packs', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), listEvidencePacks);
app.post('/api/v1/governance/evidence/packs', authenticate, govGuard, scopeGuard('write:governance', '*'), buildEvidencePack);
app.get('/api/v1/governance/evidence/packs/:id/download', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), downloadEvidencePack);

// ─── Audit Trail Routes (Evidence Layer Module 1) ───────────────────────────
// NOTE: Static routes MUST be defined BEFORE parameterized :id routes.
app.post('/api/audit-events', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createEvent);
app.get('/api/audit-events', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getAuditEvents);
app.get('/api/audit-events/stats', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getAuditEventsStats);
app.get('/api/audit-events/chain/verify', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), verifyChain);
app.get('/api/audit-events/exports', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), listExports);
app.post('/api/audit-events/export', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createExport);
app.post('/api/audit-events/preserve', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), preserve);
app.post('/api/audit-events/create-investigation', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createInvestigation);
app.post('/api/audit-events/seal-expired', authenticate, govGuard, scopeGuard('write:governance', '*'), sealExpired);
app.get('/api/audit-events/subscribe', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), subscribeSSE);
app.post('/api/audit-events/subscriptions', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createWebhookSubscription);
app.get('/api/audit-events/subscriptions', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), listSubscriptionsRoute);
app.get('/api/audit-events/subscriptions/:id', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getSubscriptionById);
app.patch('/api/audit-events/subscriptions/:id', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), updateSubscriptionRoute);
app.delete('/api/audit-events/subscriptions/:id', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), deleteSubscriptionRoute);
app.post('/api/audit-events/subscriptions/:id/test', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), testSubscription);
app.get('/api/audit-events/correlations/:key/:value/timeline', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getCorrelationTimelineHandler);
app.get('/api/audit-events/:id', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventDetail);
app.get('/api/audit-events/:id/related', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventRelated);
app.get('/api/audit-events/:id/diff', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventDiffHandler);
app.get('/api/audit-events/:id/clusters', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventClustersHandler);

// ─── Audit Trail Routes (Spec-Aligned /api/v1/evidence/audit-trail) ─────────
app.post('/api/v1/evidence/audit-trail/events', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createEvent);
app.get('/api/v1/evidence/audit-trail/events', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getAuditEvents);
app.get('/api/v1/evidence/audit-trail/events/stats', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getAuditEventsStats);
app.get('/api/v1/evidence/audit-trail/events/chain/verify', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), verifyChain);
app.get('/api/v1/evidence/audit-trail/events/exports', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), listExports);
app.post('/api/v1/evidence/audit-trail/events/export', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createExport);
app.post('/api/v1/evidence/audit-trail/events/preserve', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), preserve);
app.post('/api/v1/evidence/audit-trail/events/create-investigation', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createInvestigation);
app.post('/api/v1/evidence/audit-trail/events/seal-expired', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), sealExpired);
app.get('/api/v1/evidence/audit-trail/events/subscribe', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), subscribeSSE);
app.post('/api/v1/evidence/audit-trail/events/subscriptions', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), createWebhookSubscription);
app.get('/api/v1/evidence/audit-trail/events/subscriptions', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), listSubscriptionsRoute);
app.get('/api/v1/evidence/audit-trail/events/subscriptions/:id', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getSubscriptionById);
app.patch('/api/v1/evidence/audit-trail/events/subscriptions/:id', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), updateSubscriptionRoute);
app.delete('/api/v1/evidence/audit-trail/events/subscriptions/:id', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), deleteSubscriptionRoute);
app.post('/api/v1/evidence/audit-trail/events/subscriptions/:id/test', authenticate, auditTrailGuard, scopeGuard('write:governance', '*'), testSubscription);
app.get('/api/v1/evidence/audit-trail/events/correlations/:key/:value/timeline', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getCorrelationTimelineHandler);
app.get('/api/v1/evidence/audit-trail/events/:id', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventDetail);
app.get('/api/v1/evidence/audit-trail/events/:id/related', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventRelated);
app.get('/api/v1/evidence/audit-trail/events/:id/diff', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventDiffHandler);
app.get('/api/v1/evidence/audit-trail/events/:id/clusters', authenticate, auditTrailGuard, scopeGuard('read:governance', '*'), getEventClustersHandler);

// ─── Forensic Hub Routes ──────────────────────────────────────────────────────
app.get('/api/forensic/cases/stats', authenticate, forensicHubGuard, scopeGuard('read:governance', '*'), getForensicStats);
app.get('/api/forensic/cases/sla-report', authenticate, forensicHubGuard, scopeGuard('read:governance', '*'), getSlaReport);
// ─── Forensic Hub RBAC gate (applies to all /api/forensic/* routes) ─────────
app.use('/api/forensic', authenticate, forensicHubGuard);
app.get('/api/forensic/cases', authenticate, scopeGuard('read:governance', '*'), listForensicCases);
app.post('/api/forensic/cases', authenticate, scopeGuard('write:governance', '*'), createForensicCase);
app.get('/api/forensic/cases/:caseId', authenticate, scopeGuard('read:governance', '*'), getForensicCase);
app.patch('/api/forensic/cases/:caseId', authenticate, scopeGuard('write:governance', '*'), updateForensicCase);
app.post('/api/forensic/cases/:caseId/assign', authenticate, scopeGuard('write:governance', '*'), assignCase);
app.post('/api/forensic/cases/:caseId/evidence', authenticate, scopeGuard('write:governance', '*'), addEvidence);
app.get('/api/forensic/cases/:caseId/evidence', authenticate, scopeGuard('read:governance', '*'), listEvidence);
app.post('/api/forensic/cases/:caseId/evidence/:evidenceId/pin', authenticate, scopeGuard('write:governance', '*'), pinEvidence);
app.post('/api/forensic/cases/:caseId/notes', authenticate, scopeGuard('write:governance', '*'), addNote);
app.get('/api/forensic/cases/:caseId/notes', authenticate, scopeGuard('read:governance', '*'), listNotes);
app.post('/api/forensic/cases/:caseId/tasks', authenticate, scopeGuard('write:governance', '*'), addTask);
app.get('/api/forensic/cases/:caseId/tasks', authenticate, scopeGuard('read:governance', '*'), listTasks);
app.patch('/api/forensic/cases/:caseId/tasks/:taskId', authenticate, scopeGuard('write:governance', '*'), updateTask);
app.get('/api/forensic/cases/:caseId/actions', authenticate, scopeGuard('read:governance', '*'), listActions);
app.get('/api/forensic/cases/:caseId/timeline', authenticate, scopeGuard('read:governance', '*'), getTimeline);
app.post('/api/forensic/cases/:caseId/close', authenticate, scopeGuard('write:governance', '*'), closeCase);
app.post('/api/forensic/cases/:caseId/reopen', authenticate, scopeGuard('write:governance', '*'), reopenCase);
// Phase 2 extensions
app.post('/api/forensic/cases/:caseId/preserve', authenticate, scopeGuard('write:governance', '*'), preserveToVault);
app.post('/api/forensic/cases/:caseId/legal-hold', authenticate, scopeGuard('write:governance', '*'), applyForensicLegalHold);
app.post('/api/forensic/cases/:caseId/legal-hold/release', authenticate, scopeGuard('write:governance', '*'), releaseForensicLegalHold);
// Phase 3: Export builder
app.post('/api/forensic/cases/:caseId/exports', authenticate, scopeGuard('write:governance', '*'), createForensicExport);
app.get('/api/forensic/cases/:caseId/exports', authenticate, scopeGuard('read:governance', '*'), listForensicExports);
app.post('/api/forensic/cases/:caseId/exports/:exportId/approve', authenticate, scopeGuard('write:governance', '*'), approveExport);
app.post('/api/forensic/cases/:caseId/exports/:exportId/reject', authenticate, scopeGuard('write:governance', '*'), rejectExport);
app.post('/api/forensic/cases/:caseId/exports/:exportId/generate', authenticate, scopeGuard('write:governance', '*'), generateExport);
// Phase 3: Entity graph
app.get('/api/forensic/cases/:caseId/graph', authenticate, scopeGuard('read:governance', '*'), getEntityGraph);
// Phase 3: Evidence privilege/unpin
app.post('/api/forensic/cases/:caseId/evidence/:evidenceId/privilege', authenticate, scopeGuard('write:governance', '*'), markEvidencePrivileged);
app.post('/api/forensic/cases/:caseId/evidence/:evidenceId/unpin', authenticate, scopeGuard('write:governance', '*'), unpinEvidence);
// Phase 4: AI Assist
app.post('/api/forensic/cases/:caseId/ai/summary', authenticate, scopeGuard('write:governance', '*'), generateAiSummary);
app.get('/api/forensic/cases/:caseId/ai/summaries', authenticate, scopeGuard('read:governance', '*'), listAiSummaries);
app.post('/api/forensic/cases/:caseId/ai/summaries/:summaryId/approve', authenticate, scopeGuard('write:governance', '*'), approveSummary);
app.post('/api/forensic/cases/:caseId/ai/summaries/:summaryId/reject', authenticate, scopeGuard('write:governance', '*'), rejectSummary);
app.post('/api/forensic/cases/:caseId/ai/timeline-explanation', authenticate, scopeGuard('write:governance', '*'), generateTimelineExplanation);
app.post('/api/forensic/cases/:caseId/ai/anomalies', authenticate, scopeGuard('write:governance', '*'), detectAnomalies);
app.get('/api/forensic/cases/:caseId/ai/anomalies', authenticate, scopeGuard('read:governance', '*'), listAnomalies);
app.post('/api/forensic/cases/:caseId/ai/recommendations', authenticate, scopeGuard('write:governance', '*'), generateRecommendations);
// Phase 4: SIEM Routing
app.post('/api/forensic/cases/:caseId/siem/route', authenticate, scopeGuard('write:governance', '*'), routeToSiem);
app.get('/api/forensic/cases/:caseId/siem/history', authenticate, scopeGuard('read:governance', '*'), getSiemHistory);
// Phase 4: External Auditor
app.post('/api/forensic/auditor/session', authenticate, scopeGuard('write:governance', '*'), createAuditorSession);
// Phase 4: Export Narrative
app.get('/api/forensic/exports/:exportId/narrative', authenticate, scopeGuard('read:governance', '*'), getExportNarrative);

// ─── Evidence Vault RBAC gate (applies to all /api/evidence-vault/* routes) ──
app.use('/api/evidence-vault', authenticate, evidenceVaultGuard);
// ─── Evidence Vault Routes (Evidence Layer Module 3) ────────────────────────────
app.get('/api/evidence-vault/health', authenticate, scopeGuard('read:governance', '*'), getVaultHealth);
app.get('/api/evidence-vault/items', authenticate, scopeGuard('read:governance', '*'), listVaultEvidenceItems);
app.get('/api/evidence-vault/items/:id', authenticate, scopeGuard('read:governance', '*'), getEvidenceItem);
app.post('/api/evidence-vault/items/preserve', authenticate, scopeGuard('write:governance', '*'), preserveEvidence);
app.post('/api/evidence-vault/items/:id/verify', authenticate, scopeGuard('write:governance', '*'), verifyVaultEvidenceItem);
app.get('/api/evidence-vault/collections', authenticate, scopeGuard('read:governance', '*'), listCollections);
app.post('/api/evidence-vault/collections', authenticate, scopeGuard('write:governance', '*'), createCollection);
app.get('/api/evidence-vault/collections/:id', authenticate, scopeGuard('read:governance', '*'), getCollection);
app.post('/api/evidence-vault/collections/:id/items', authenticate, scopeGuard('write:governance', '*'), addItemsToCollection);
app.get('/api/evidence-vault/collections/:id/items', authenticate, scopeGuard('read:governance', '*'), getVaultCollectionItems);

// ─── Evidence Vault Phase 2 Routes ───────────────────────────────────────────────
app.post('/api/evidence-vault/packages', authenticate, scopeGuard('write:governance', '*'), createPackage);
app.get('/api/evidence-vault/packages', authenticate, scopeGuard('read:governance', '*'), listVaultPackages);
app.get('/api/evidence-vault/packages/:id', authenticate, scopeGuard('read:governance', '*'), getVaultPackage);
app.post('/api/evidence-vault/packages/:id/seal', authenticate, scopeGuard('write:governance', '*'), sealVaultPackage);
app.get('/api/evidence-vault/packages/:id/manifest', authenticate, scopeGuard('read:governance', '*'), getVaultPackageManifest);
app.post('/api/evidence-vault/packages/:id/verify', authenticate, scopeGuard('write:governance', '*'), verifyVaultPackage);
app.post('/api/evidence-vault/exports', authenticate, scopeGuard('write:governance', '*'), createVaultExport);
app.get('/api/evidence-vault/exports', authenticate, scopeGuard('read:governance', '*'), listVaultExports);
app.get('/api/evidence-vault/exports/:id/receipt', authenticate, scopeGuard('read:governance', '*'), getExportReceipt);
app.post('/api/evidence-vault/holds', authenticate, scopeGuard('write:governance', '*'), applyHold);
app.get('/api/evidence-vault/holds', authenticate, scopeGuard('read:governance', '*'), listVaultHolds);
app.post('/api/evidence-vault/holds/:id/release', authenticate, scopeGuard('write:governance', '*'), releaseHold);
app.delete('/api/evidence-vault/holds/:id', authenticate, scopeGuard('write:governance', '*'), deleteVaultHold);
app.post('/api/evidence-vault/redaction-policies', authenticate, scopeGuard('write:governance', '*'), createRedactionPolicy);
app.get('/api/evidence-vault/redaction-policies', authenticate, scopeGuard('read:governance', '*'), listRedactionPolicies);

// ─── Evidence Vault Phase 3 Routes ───────────────────────────────────────────────
app.post('/api/evidence-vault/shares', authenticate, scopeGuard('write:governance', '*'), createShare);
app.get('/api/evidence-vault/shares', authenticate, scopeGuard('read:governance', '*'), listVaultShares);
app.get('/api/evidence-vault/shares/:id', authenticate, scopeGuard('read:governance', '*'), getVaultShare);
app.post('/api/evidence-vault/shares/:id/revoke', authenticate, scopeGuard('write:governance', '*'), revokeShare);
app.get('/api/evidence-vault/shares/:id/access-logs', authenticate, scopeGuard('read:governance', '*'), getShareAccessLogs);
app.post('/api/evidence-vault/dlp-scans', authenticate, scopeGuard('write:governance', '*'), runDlpScan);
app.get('/api/evidence-vault/dlp-scans', authenticate, scopeGuard('read:governance', '*'), listDlpScans);
app.get('/api/evidence-vault/dlp-scans/:id', authenticate, scopeGuard('read:governance', '*'), getDlpScan);

// ─── Evidence Vault Phase 4 Routes ───────────────────────────────────────────────
app.post('/api/evidence-vault/jobs', authenticate, scopeGuard('write:governance', '*'), createAsyncJob);
app.get('/api/evidence-vault/jobs', authenticate, scopeGuard('read:governance', '*'), listVaultAsyncJobs);
app.get('/api/evidence-vault/jobs/:id', authenticate, scopeGuard('read:governance', '*'), getAsyncJob);
app.post('/api/evidence-vault/chain-anchors', authenticate, scopeGuard('write:governance', '*'), createChainAnchor);
app.get('/api/evidence-vault/chain-anchors', authenticate, scopeGuard('read:governance', '*'), listChainAnchors);
app.get('/api/evidence-vault/chain-anchors/:anchorId/verify', authenticate, scopeGuard('read:governance', '*'), verifyChainAnchor);
app.post('/api/evidence-vault/templates', authenticate, scopeGuard('write:governance', '*'), createTemplateVersion);
app.get('/api/evidence-vault/templates', authenticate, scopeGuard('read:governance', '*'), listTemplateVersions);

// ─── Identity Ledger RBAC gate (applies to all /api/identity-ledger/* routes) ─
app.use('/api/identity-ledger', authenticate, identityLedgerGuard);
// Identity Ledger
app.get('/api/identity-ledger/entries', authenticate, scopeGuard('read:governance', '*'), listIdentityLedgerEntries);
app.get('/api/identity-ledger/actors', authenticate, scopeGuard('read:governance', '*'), listIdentityActors);
app.get('/api/identity-ledger/actors/:actorId', authenticate, scopeGuard('read:governance', '*'), getIdentityActor);
app.get('/api/identity-ledger/actors/:actorId/timeline', authenticate, scopeGuard('read:governance', '*'), getIdentityActorTimeline);
app.get('/api/identity-ledger/authority-snapshots/:snapshotId', authenticate, scopeGuard('read:governance', '*'), getIdentityAuthoritySnapshot);
app.get('/api/identity-ledger/authority-at-event/:auditEventId', authenticate, scopeGuard('read:governance', '*'), getIdentityAuthorityAtEvent);
app.get('/api/identity-ledger/chain/verify', authenticate, scopeGuard('read:governance', '*'), verifyIdentityLedgerChain);
app.get('/api/identity-ledger/delegations', authenticate, scopeGuard('read:governance', '*'), listDelegations);
app.post('/api/identity-ledger/delegations', authenticate, scopeGuard('write:governance', '*'), createDelegation);
app.post('/api/identity-ledger/delegations/:id/revoke', authenticate, scopeGuard('write:governance', '*'), revokeDelegation);
app.get('/api/identity-ledger/break-glass', authenticate, scopeGuard('read:governance', '*'), listBreakGlass);
app.post('/api/identity-ledger/break-glass/request', authenticate, scopeGuard('write:governance', '*'), requestBreakGlass);
app.post('/api/identity-ledger/break-glass/:id/activate', authenticate, scopeGuard('write:governance', '*'), activateBreakGlass);
app.post('/api/identity-ledger/break-glass/:id/end', authenticate, scopeGuard('write:governance', '*'), endBreakGlass);
app.post('/api/identity-ledger/break-glass/:id/review', authenticate, scopeGuard('write:governance', '*'), reviewBreakGlass);
app.post('/api/identity-ledger/export', authenticate, scopeGuard('write:governance', '*'), exportLedger);
app.post('/api/identity-ledger/preserve', authenticate, scopeGuard('write:governance', '*'), identityLedgerPreserveToVault);

// Identity Ledger — Phase 2 Governance Depth
app.get('/api/identity-ledger/service-accounts', authenticate, scopeGuard('read:governance', '*'), listServiceAccounts);
app.post('/api/identity-ledger/service-accounts', authenticate, scopeGuard('write:governance', '*'), registerServiceAccount);
app.post('/api/identity-ledger/service-accounts/:actorId/revoke', authenticate, scopeGuard('write:governance', '*'), revokeServiceAccount);
app.get('/api/identity-ledger/actors/:actorId/timeline/sessions', authenticate, scopeGuard('read:governance', '*'), getActorTimelineWithSessions);
app.post('/api/identity-ledger/actors/:actorId/risk/evaluate', authenticate, scopeGuard('write:governance', '*'), evaluateActorRiskFlags);
app.put('/api/identity-ledger/actors/:actorId/risk/flags', authenticate, scopeGuard('write:governance', '*'), setActorRiskFlags);

// Protected Risk & Compliance Command Center
app.get('/api/v1/governance/risk/pulse', authenticate, govGuard, scopeGuard('read:governance', '*'), getRiskPulse);
app.get('/api/v1/governance/risk/feed', authenticate, govGuard, scopeGuard('read:governance', '*'), getActiveRiskFeed);
app.get('/api/v1/governance/risk/gaps', authenticate, govGuard, scopeGuard('read:governance', '*'), getGovernanceGaps);
app.post('/api/v1/governance/risk/emergency-pause', authenticate, govGuard, scopeGuard('read:governance', '*'), triggerEmergencyPause);

// Safety Layer Overview (Document 01) endpoints
app.get('/api/safety/overview',                       authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetyOverview);
app.get('/api/safety/components',                     authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetyComponents);
app.get('/api/safety/queue/summary',                  authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetyQueueSummary);
app.get('/api/safety/recent-decisions',               authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetyRecentDecisions);
app.post('/api/safety/actions/review-critical-queue', authenticate, safetyGuard, scopeGuard('write:governance', '*'), reviewCriticalQueue);
app.post('/api/safety/actions/request-emergency-pause', authenticate, safetyGuard, scopeGuard('write:governance', '*'), requestEmergencyPause);
// Safety Layer Risk Intake & Triage (Document 02) endpoints
app.get('/api/safety/signals',                authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetySignals);
app.get('/api/safety/signals/:id',            authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetySignalDetail);
app.post('/api/safety/signals',               authenticate, safetyGuard, scopeGuard('write:governance', '*'), createManualSignal);
app.post('/api/safety/signals/:id/classify',  authenticate, safetyGuard, scopeGuard('write:governance', '*'), classifySafetySignal);
app.post('/api/safety/signals/:id/route',     authenticate, safetyGuard, scopeGuard('write:governance', '*'), routeSafetySignal);
app.post('/api/safety/signals/:id/merge',     authenticate, safetyGuard, scopeGuard('write:governance', '*'), mergeSafetySignals);
app.post('/api/safety/signals/:id/split',     authenticate, safetyGuard, scopeGuard('write:governance', '*'), splitSafetySignal);
app.post('/api/safety/signals/:id/close',     authenticate, safetyGuard, scopeGuard('write:governance', '*'), closeSafetySignal);
app.get('/api/safety/actions/history',        authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getSafetyActionsHistory);

// Safety Layer Policy Control Matrix & Guardrail Enforcement endpoints
app.get('/api/safety/policies/summary',     authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getPolicySummary);
app.get('/api/safety/policies',             authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getPolicies);
app.post('/api/safety/policies',            authenticate, safetyGuard, scopeGuard('write:governance', '*'), createPolicy);
app.post('/api/safety/policies/simulate',   authenticate, safetyGuard, scopeGuard('write:governance', '*'), simulatePolicy);
app.get('/api/safety/enforcement/events',   authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getEnforcementEvents);

// Safety Layer Human Review, Escalation & Approval Console endpoints
app.get('/api/safety/reviews',              authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getReviewQueue);
app.get('/api/safety/reviews/:id',          authenticate, safetyGuard, scopeGuard('read:governance', '*'),  getReviewDetail);
app.post('/api/safety/reviews/:id/decision', authenticate, safetyGuard, scopeGuard('write:governance', '*'), submitReviewDecision);

// Forensic Analysis Engine
app.get('/api/v1/governance/forensic/summary', authenticate, govGuard, scopeGuard('read:governance', '*'), getForensicSummary);
app.get('/api/v1/governance/forensic/agents/:agentId', authenticate, govGuard, scopeGuard('read:governance', '*'), getAgentPerformance);
app.get('/api/v1/governance/collusion/metrics', authenticate, govGuard, scopeGuard('read:governance', '*'), getCollusionMetrics);

// Global Operations Telemetry
app.get('/api/v1/operations/telemetry', authenticate, scopeGuard('read:analytics', '*'), getSystemTelemetry);
app.get('/api/v1/operations/logs', authenticate, scopeGuard('read:analytics', '*'), getMissionLogs);

// Global Discovery
app.get('/api/v1/search', authenticate, scopeGuard('read:content', '*'), performGlobalSearch);

// Protected Brand Standards & Content Governance
app.get('/api/v1/governance/brand/profiles', authenticate, govGuard, scopeGuard('read:governance', '*'), getBrandProfiles);
app.post('/api/v1/governance/brand/profiles', authenticate, govGuard, scopeGuard('write:governance', '*'), createBrandProfile);
app.get('/api/v1/governance/brand/linguistic', authenticate, govGuard, scopeGuard('read:governance', '*'), getLinguisticProfile);
app.get('/api/v1/governance/brand/claims', authenticate, govGuard, scopeGuard('read:governance', '*'), getClaimsLedger);
app.post('/api/v1/governance/brand/rules', authenticate, govGuard, scopeGuard('read:governance', '*'), updateBrandRule);

// Public OAuth
app.post('/api/auth/oauth/nonce', authenticate, authRateLimit, generateOAuthNonce);
app.get('/api/auth/facebook/callback', handleFacebookCallback);
app.get('/api/auth/linkedin/callback', handleLinkedInCallback);
app.get('/api/auth/pinterest/callback', handlePinterestCallback);
app.get('/api/auth/threads/callback', handleThreadsCallback);
app.post('/api/auth/threads/deauthorize', handleThreadsDeauthorize);
app.post('/api/auth/threads/data-deletion', handleThreadsDataDeletion);
app.post('/api/auth/twitter/init', authenticate, initTwitterOAuth);
app.get('/api/auth/twitter/callback', handleTwitterCallback);
app.get('/api/auth/youtube/callback', handleYoutubeCallback);
app.get('/api/auth/googleads/callback', handleGoogleAdsCallback);
// Protected Social/Account Routes
app.delete('/api/v1/accounts/:id', authenticate, accountsGuard, disconnectAccount);
app.get('/api/v1/accounts/linkedin/pages', authenticate, accountsGuard, getLinkedInPagesSession);
app.post('/api/v1/accounts/linkedin/pages', authenticate, accountsGuard, saveLinkedInPages);

// LinkedIn Community Management Routes
app.get('/api/v1/linkedin/:accountId/feed',        authenticate, newInboxGuard, getLinkedInPageFeed);
app.get('/api/v1/linkedin/:accountId/analytics',   authenticate, newInboxGuard, getLinkedInPageAnalytics);
app.get('/api/v1/linkedin/:accountId/comments',    authenticate, newInboxGuard, getLinkedInPostComments);
app.post('/api/v1/linkedin/:accountId/reply',      authenticate, newInboxGuard, replyToLinkedInPost);
app.delete('/api/v1/linkedin/:accountId/comment',  authenticate, newInboxGuard, deleteLinkedInComment);

// Campaigns & Projects Routes
const campaignGuard = requireRole('SUPERADMIN', 'ADMIN', 'WORKSPACE_OWNER', 'CAMPAIGN_MANAGER', 'MANAGER', 'CREATOR', 'ANALYST', 'REVIEWER', 'VIEWER', 'PUBLISHER', 'GOVERNANCE_ADMIN', 'AUDITOR', 'APPROVER', 'VALIDATOR', 'BRAND_REVIEWER', 'COMPLIANCE_REVIEWER', 'SECURITY_ADMIN', 'PRIVACY_ADMIN');
const campaignWriteGuard = requireRole('ADMIN', 'WORKSPACE_OWNER', 'CAMPAIGN_MANAGER', 'SUPERADMIN');
// Launch guard relaxed to campaignWriteGuard while the campaign flow is being validated.
// Restore the original APPROVER/FINAL_APPROVER restriction once governance is re-enabled.
const campaignLaunchGuard = requireRole('ADMIN', 'WORKSPACE_OWNER', 'CAMPAIGN_MANAGER', 'SUPERADMIN');
const campaignEmergencyGuard = requireRole('CRISIS_COMMANDER', 'FINAL_APPROVER', 'ADMIN', 'WORKSPACE_OWNER', 'SUPERADMIN');

// Phase 1 — existing CRUD
app.get('/api/v1/campaigns',           authenticate, campaignGuard,       listCampaigns);
app.get('/api/v1/campaigns/stats',     authenticate, campaignGuard,       cache(30), getCampaignStats);
app.get('/api/v1/campaigns/:id',       authenticate, campaignGuard,       getCampaign);
app.get('/api/v1/campaigns/:id/posts', authenticate, campaignGuard,       getCampaignPosts);
app.post('/api/v1/campaigns',          authenticate, campaignWriteGuard,  requireBillingExecution('campaign_create'), createCampaign);
app.patch('/api/v1/campaigns/:id',     authenticate, campaignWriteGuard,  updateCampaign);
app.delete('/api/v1/campaigns/:id',    authenticate, campaignWriteGuard,  deleteCampaign);

// Bulk pixel assignment
app.post('/api/v1/campaigns/bulk/assign-pixel', authenticate, campaignWriteGuard, bulkAssignPixel);

// Campaign lifecycle
app.post('/api/v1/campaigns/:id/submit-review',   authenticate, campaignWriteGuard,    submitCampaignForReview);
app.post('/api/v1/campaigns/:id/approve',         authenticate, campaignLaunchGuard,   approveCampaign);
app.get('/api/v1/campaigns/:id/launch-gate',      authenticate, campaignGuard,         checkLaunchGate);
app.post('/api/v1/campaigns/:id/launch',          authenticate, campaignLaunchGuard,   requireBillingExecution('campaign_create'), launchCampaign);
app.post('/api/v1/campaigns/:id/pause',           authenticate, campaignWriteGuard,    pauseCampaign);
app.post('/api/v1/campaigns/:id/resume',          authenticate, campaignWriteGuard,    resumeCampaign);
app.post('/api/v1/campaigns/:id/emergency-pause', authenticate, campaignEmergencyGuard, emergencyPauseCampaign);
app.get('/api/v1/campaigns/:id/events',           authenticate, campaignGuard,        getCampaignEvents);
app.patch('/api/v1/campaigns/:id/spend',          authenticate, campaignWriteGuard,   requireBillingExecution('budget_increase'), updateSpend);
app.post('/api/v1/campaigns/:id/push-to-meta',   authenticate, campaignLaunchGuard,  pushCampaignToMetaHandler);

// Client Meta Account routes (bring-your-own-account model)
import { listClientCampaignAccounts, fetchMetaAdAccounts, setAdAccount, fetchMetaPages, fetchMetaPixels, getPixelStats, createPixel, updatePixelName, deleteMetaPixel } from './domains/campaigns/metaAccountController';
import { publishToMeta, toggleMetaStatus, deleteFromMeta, syncFromMeta, getAdAccountDetails, verifyMetaCampaign } from './domains/campaigns/metaPublishController';
import { searchLocations, searchInterests, getReachEstimate } from './domains/campaigns/metaTargetingSearch';
import { getCapiIntegrationKey, testCapiEvent, sendCapiEvents } from './domains/campaigns/capiController';

// Meta Pixel Connector
app.get('/api/v1/campaigns/meta/pixels',                               authenticate, campaignGuard,      fetchMetaPixels);
app.post('/api/v1/campaigns/meta/pixels',                              authenticate, campaignWriteGuard, createPixel);
app.get('/api/v1/campaigns/meta/pixels/:pixelId/stats',                authenticate, campaignGuard,      getPixelStats);
app.patch('/api/v1/campaigns/meta/pixels/:pixelId',                    authenticate, campaignWriteGuard, updatePixelName);
app.delete('/api/v1/campaigns/meta/pixels/:pixelId',                   authenticate, campaignWriteGuard, deleteMetaPixel);

// Meta Conversions API (CAPI) — server-side event tracking
app.get('/api/v1/campaigns/meta/pixels/:pixelId/capi/key',             authenticate, campaignWriteGuard, getCapiIntegrationKey);
app.post('/api/v1/campaigns/meta/pixels/:pixelId/capi/test',           authenticate, campaignWriteGuard, testCapiEvent);
app.post('/api/v1/campaigns/meta/pixels/:pixelId/capi/events',         sendCapiEvents);  // public — auth via integration key

// Client Meta account management
app.get('/api/v1/campaigns/meta/accounts',                        authenticate, campaignGuard, listClientCampaignAccounts);
app.post('/api/v1/campaigns/meta/accounts/:id/fetch-ad-accounts', authenticate, campaignGuard, fetchMetaAdAccounts);
app.post('/api/v1/campaigns/meta/accounts/:id/set-ad-account',    authenticate, campaignWriteGuard, setAdAccount);
app.get('/api/v1/campaigns/meta/pages',                           authenticate, campaignGuard, fetchMetaPages);

// Meta campaign publish / sync
app.post('/api/v1/campaigns/:id/publish-to-meta',    authenticate, campaignWriteGuard,  requireBillingExecution('publish'), publishToMeta);
app.get('/api/v1/campaigns/:id/meta-verify',         authenticate, campaignGuard,       verifyMetaCampaign);
app.post('/api/v1/campaigns/:id/toggle-meta-status', authenticate, campaignWriteGuard, toggleMetaStatus);
app.delete('/api/v1/campaigns/:id/meta',             authenticate, campaignWriteGuard, deleteFromMeta);
app.post('/api/v1/campaigns/meta/sync',              authenticate, campaignGuard,        syncFromMeta);
app.get('/api/v1/campaigns/meta/ad-account-details', authenticate, campaignGuard,        getAdAccountDetails);

// Meta targeting search (locations + interests from Meta API)
app.get('/api/v1/campaigns/meta/search/locations',    authenticate, campaignGuard, searchLocations);
app.get('/api/v1/campaigns/meta/search/interests',    authenticate, campaignGuard, searchInterests);
app.post('/api/v1/campaigns/meta/reach-estimate',     authenticate, campaignGuard, getReachEstimate);

// Budget Authorization routes (Phase 4)
app.post('/api/v1/campaigns/:id/budget-auth/request', authenticate, campaignWriteGuard,    requestBudgetAuth);
app.get('/api/v1/campaigns/:id/budget-auth',          authenticate, campaignGuard,         getBudgetAuthForCampaign);
app.get('/api/v1/budget-authorizations',              authenticate, campaignGuard,         listBudgetAuths);
app.post('/api/v1/budget-authorizations/:id/approve', authenticate, campaignLaunchGuard,   requireBillingExecution('budget_increase'), approveBudgetAuth);
app.post('/api/v1/budget-authorizations/:id/reject',  authenticate, campaignLaunchGuard,   rejectBudgetAuth);

// Ads / Boost routes (Meta Ads — Phase 2)
const adsGuard = requireRole('ADMIN', 'WORKSPACE_OWNER', 'CAMPAIGN_MANAGER', 'SUPERADMIN');
app.get('/api/v1/ads/accounts/:connectedAccountId/ad-accounts',  authenticate, adsGuard, getMetaAdAccounts);
app.post('/api/v1/ads/accounts/:connectedAccountId/link-ad-account', authenticate, adsGuard, linkAdAccount);
app.post('/api/v1/ads/boosts',          authenticate, adsGuard, createBoost);
app.get('/api/v1/ads/boosts',           authenticate, adsGuard, listBoosts);
app.post('/api/v1/ads/boosts/:id/sync', authenticate, adsGuard, syncBoostMetrics);
app.post('/api/v1/ads/boosts/:id/pause',   authenticate, adsGuard, pauseBoost);
app.post('/api/v1/ads/boosts/:id/resume',  authenticate, adsGuard, resumeBoost);
app.delete('/api/v1/ads/boosts/:id',       authenticate, adsGuard, cancelBoost);
app.get('/api/v1/campaigns/:id/insights',             authenticate, adsGuard, getCampaignInsights);
app.get('/api/v1/campaigns/:id/insights/breakdown',   authenticate, adsGuard, getCampaignBreakdownInsights);
app.get('/api/v1/campaigns/:id/insights/trend',       authenticate, adsGuard, getCampaignTrend);
app.get('/api/v1/campaigns/:id/insights/ads',         authenticate, adsGuard, getCampaignAdInsights);
app.patch('/api/v1/campaigns/:id/budget-meta',         authenticate, adsGuard, syncBudgetToMeta);

// Google Ads / Boost routes (Phase 2b)
app.get('/api/v1/ads/google/accounts/:connectedAccountId/customers',      authenticate, adsGuard, getGoogleAdsCustomers);
app.post('/api/v1/ads/google/accounts/:connectedAccountId/link-customer', authenticate, adsGuard, linkGoogleAdsCustomer);
app.post('/api/v1/ads/google/boosts',            authenticate, adsGuard, createGoogleBoost);
app.post('/api/v1/ads/google/boosts/:id/sync',   authenticate, adsGuard, syncGoogleMetrics);
app.post('/api/v1/ads/google/boosts/:id/pause',  authenticate, adsGuard, pauseGoogleBoost);
app.post('/api/v1/ads/google/boosts/:id/resume', authenticate, adsGuard, resumeGoogleBoost);
app.delete('/api/v1/ads/google/boosts/:id',      authenticate, adsGuard, cancelGoogleBoost);

// Protected Scheduler Routes
app.post('/api/v1/scheduler/recommend', authenticate, planRateLimit('general'), scopeGuard('read:content', '*'), getRecommendations);
app.post('/api/v1/scheduler/best-slot',  authenticate, planRateLimit('general'), scopeGuard('read:content', '*'), getBestSlot);
app.get('/api/v1/scheduler/health',      authenticate, scopeGuard('read:content', '*'), getSchedulerHealth);
app.get('/api/v1/scheduler/posts',       authenticate, planRateLimit('general'), scopeGuard('read:content', '*'), listScheduledPosts);
app.get('/api/v1/scheduler/posts/:id',   authenticate, planRateLimit('general'), scopeGuard('read:content', '*'), getScheduledPost);
app.post('/api/v1/scheduler/posts',      authenticate, planRateLimit('general'), scopeGuard('write:content', '*'), schedulePost);
app.put('/api/v1/scheduler/posts/:id',   authenticate, planRateLimit('general'), scopeGuard('write:content', '*'), updateScheduledPost);
app.delete('/api/v1/scheduler/posts/:id',authenticate, planRateLimit('general'), scopeGuard('write:content', '*'), cancelScheduledPost);

// Protected Library Routes
const mediaReadGuard  = requireRole('ADMIN','WORKSPACE_OWNER','CAMPAIGN_MANAGER','MANAGER','CREATOR','PUBLISHER','REVIEWER','AUDITOR','VIEWER','SUPERADMIN');
const mediaWriteGuard = requireRole('ADMIN','WORKSPACE_OWNER','CAMPAIGN_MANAGER','CREATOR','SUPERADMIN');
const mediaDeleteGuard = requireRole('ADMIN','WORKSPACE_OWNER','CAMPAIGN_MANAGER','CREATOR','SUPERADMIN');
app.get('/api/v1/library', authenticate, mediaReadGuard, planRateLimit('general'), scopeGuard('read:content', '*'), listLibrary);
app.post('/api/v1/library/upload', authenticate, mediaWriteGuard, planRateLimit('general'), scopeGuard('write:content', '*'), addToLibrary);
app.delete('/api/v1/library/:id', authenticate, mediaDeleteGuard, planRateLimit('general'), scopeGuard('write:content', '*'), deleteFromLibrary);
app.get('/api/v1/monitoring/storage-items', authenticate, mediaReadGuard, scopeGuard('read:content', '*'), listStorageItems);
app.post('/api/v1/library/bulk-delete', authenticate, mediaDeleteGuard, scopeGuard('write:content', '*'), bulkDeleteFromLibrary);
app.post('/api/v1/media/scan', authenticate, mediaWriteGuard, planRateLimit('general'), scopeGuard('write:content', '*'), scanMediaUrl);
app.get('/api/v1/library/scan-logs', authenticate, requireRole('ADMIN','WORKSPACE_OWNER','DEVELOPER','GOVERNANCE_ADMIN','SUPERADMIN'), scopeGuard('read:content', '*'), (req: any, res: any) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  res.json({ success: true, data: readRecentScans(limit, req.user?.workspace_id) });
});

// Sidebar combined counts (pending review + returned items in one round-trip)
app.get("/api/v1/drafts",        authenticate, publishHubGuard, scopeGuard("read:content", "*"), listDraftPosts);
app.get("/api/v1/drafts/count",  authenticate, publishHubGuard, cache(20), getDraftCount);
app.get("/api/v1/drafts/:id",    authenticate, publishHubGuard, scopeGuard("read:content", "*"), getDraftPost);
app.post("/api/v1/drafts",       authenticate, publishHubGuard, scopeGuard("write:content", "*"), saveDraftPost);
app.patch("/api/v1/drafts/:id",  authenticate, publishHubGuard, scopeGuard("write:content", "*"), updateDraftPost);
app.delete("/api/v1/drafts/:id", authenticate, publishHubGuard, scopeGuard("write:content", "*"), deleteDraftPost);
app.get('/api/v1/sidebar/counts', authenticate, cache(20), getSidebarCounts);

// Calendar — unified workspace-scoped events (scheduler posts + publish intents)
app.get('/api/v1/calendar/events', authenticate, calendarGuard, getCalendarEvents);

// Protected User Routes
app.get('/api/v1/user/context', authenticate, cache(30), getUserContext);
app.patch('/api/v1/admin/plan', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER', 'SUPERADMIN'), changePlan);
app.post('/api/v1/user/downgrade-to-free', authenticate, SuperAdminController.downgradeToFreePlan);

// Workspace Settings Routes
const workspaceGuard = requireRole('ADMIN', 'WORKSPACE_OWNER', 'SECURITY_ADMIN', 'PRIVACY_ADMIN', 'SUPERADMIN');
app.get('/api/v1/workspace/settings', authenticate, workspaceGuard, cache(60), getWorkspaceSettings);
app.patch('/api/v1/workspace/settings', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), updateWorkspaceSettings);
app.get('/api/v1/workspace/data-export', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), exportWorkspaceData);

// Retention Settings - Privacy & Data tab
app.get('/api/v1/retention/settings',  authenticate, privacyDataGuard, getRetentionSettings);
app.put('/api/v1/retention/settings',  authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), updateRetentionSettings);
app.post('/api/v1/retention/run-now',  authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), triggerRetentionRun);
app.get('/api/v1/retention/logs',      authenticate, privacyDataGuard, getRetentionLogs);

// Workflow RBAC guards
const workflowView = requireRole('ADMIN', 'WORKSPACE_OWNER', 'AGENT_ARCHITECT', 'SUPERADMIN');
const workflowWrite = requireRole('ADMIN', 'WORKSPACE_OWNER', 'AGENT_ARCHITECT', 'SUPERADMIN');
const workflowApprove = requireRole('ADMIN', 'WORKSPACE_OWNER', 'AGENT_ARCHITECT', 'SUPERADMIN');
const workflowAdmin = requireRole('ADMIN', 'WORKSPACE_OWNER', 'SUPERADMIN');

// Workspace Settings Routes
// Protected Account Routes
app.get('/api/v1/accounts', authenticate, accountsGuard, listAccounts);
app.get('/api/v1/analytics/platform-reach', authenticate, getPlatformReach);

// Protected Team Routes
app.get('/api/v1/team/members', authenticate, teamMgmtGuard, listMembers);
app.patch('/api/v1/team/members/:id/role', authenticate, teamMgmtGuard, updateMemberRole);
app.delete('/api/v1/team/members/:id', authenticate, teamMgmtGuard, deleteMember);
app.get('/api/v1/team/requests', authenticate, teamMgmtGuard, listRequests);
app.post('/api/v1/team/requests', authenticate, teamMgmtGuard, createRequest);
app.put('/api/v1/team/requests/:id', authenticate, teamMgmtGuard, updateRequest);

// Business units / Organization Structure
app.get('/api/v1/units/stats', authenticate, getUnitStats);
app.get('/api/v1/units', authenticate, listUnits);
app.get('/api/v1/units/:id', authenticate, getUnit);
app.get('/api/v1/units/:id/children', authenticate, getUnitChildren);
app.post('/api/v1/units', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), createUnit);
app.put('/api/v1/units/:id', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), updateUnit);
app.post('/api/v1/units/:id/archive', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), archiveUnit);
app.post('/api/v1/units/:id/restore', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), restoreUnit);
app.delete('/api/v1/units/:id', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), deleteUnit);
// Unit members
app.get('/api/v1/units/:id/members/available', authenticate, getAvailableMembers);
app.get('/api/v1/units/:id/members', authenticate, getUnitMembers);
app.post('/api/v1/units/:id/members', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), addUnitMember);
app.delete('/api/v1/units/:id/members/:memberId', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), removeUnitMember);
// Unit brands
app.get('/api/v1/units/:id/brands', authenticate, getUnitBrands);
app.post('/api/v1/units/:id/brands', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), linkUnitBrand);
app.delete('/api/v1/units/:id/brands/:brandId', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), unlinkUnitBrand);
// Unit activity
app.get('/api/v1/units/:id/activity', authenticate, getUnitActivity);
// Unit evidence scope
app.get('/api/v1/units/:id/evidence-scope', authenticate, getUnitEvidenceScope);
app.post('/api/v1/units/:id/evidence-scope', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), setUnitEvidenceScope);
app.delete('/api/v1/units/:id/evidence-scope/:scopeId', authenticate, requireRole('ADMIN', 'WORKSPACE_OWNER'), deleteUnitEvidenceScope);

// Protected Notification Routes
app.get('/api/v1/notifications', authenticate, listNotifications);
app.patch('/api/v1/notifications/:id/read', authenticate, markAsRead);
app.post('/api/v1/notifications/mark-all-read', authenticate, markAllRead);
app.delete('/api/v1/notifications/:id', authenticate, deleteNotification);
app.delete('/api/v1/notifications', authenticate, clearNotifications);

// Protected Agent/Workflow Routes
// Autonomy Control Routes
app.get('/api/v1/autonomy/stats', authenticate, agentReadGuard, scopeGuard('read:agents', '*'), getAutonomyStats);
app.patch('/api/v1/autonomy/agents/:id/level', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), updateAgentLevel);
app.post('/api/v1/autonomy/agents/:id/suspend', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), suspendAgent);
app.get('/api/v1/autonomy/emergency-locks', authenticate, agentReadGuard, scopeGuard('read:agents', '*'), listEmergencyLocks);
app.post('/api/v1/autonomy/emergency-locks', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), createEmergencyLock);
app.delete('/api/v1/autonomy/emergency-locks/:id', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), liftEmergencyLock);
app.get('/api/v1/autonomy/hitl-rules', authenticate, agentReadGuard, scopeGuard('read:agents', '*'), listHITLRules);
app.post('/api/v1/autonomy/hitl-rules', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), upsertHITLRule);
app.put('/api/v1/autonomy/hitl-rules/:id', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), upsertHITLRule);
app.delete('/api/v1/autonomy/hitl-rules/:id', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), deleteHITLRule);
app.get('/api/v1/autonomy/negative-knowledge', authenticate, agentReadGuard, scopeGuard('read:agents', '*'), listNegativeKnowledge);
app.post('/api/v1/autonomy/negative-knowledge', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), createNegativeKnowledge);
app.delete('/api/v1/autonomy/negative-knowledge/:id', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), deleteNegativeKnowledge);

// ─── Agent RBAC gate ─────────────────────────────────────────────────────────
app.use('/api/v1/agents', authenticate, agentReadGuard);
app.get('/api/v1/agents', authenticate, scopeGuard('read:agents', '*'), listAgents);
// ─── Workflow Routes ──────────────────────────────────────────────────────────
// All endpoints under /api/v1/agents/workflows manage workflow templates,
// versions, instances, approvals, simulations, evidence, exports, and Three-Key
// approval chains. Middleware: authenticate → workflowView/Write/Approve/Admin
// → scopeGuard. See workflowController.ts for each handler's JSDoc.

app.get('/api/v1/agents/workflows', authenticate, workflowView, scopeGuard('read:agents', '*'), listWorkflows);
app.get('/api/v1/agents/workflows/stats', authenticate, workflowView, scopeGuard('read:agents', '*'), getWorkflowStats);
app.get('/api/v1/agents/workflows/control-strip', authenticate, workflowView, scopeGuard('read:agents', '*'), getControlStrip);
app.get('/api/v1/agents/workflows/analytics', authenticate, workflowView, scopeGuard('read:agents', '*'), getWorkflowAnalytics);
app.get('/api/v1/agents/workflows/active', authenticate, workflowView, scopeGuard('read:agents', '*'), getActiveOrchestrations);
app.get('/api/v1/agents/workflows/published-content', authenticate, workflowView, scopeGuard('read:agents', '*'), getPublishedContent);
app.get('/api/v1/agents/workflows/published-content/:id/meta', authenticate, workflowView, scopeGuard('read:agents', '*'), getPublishedContentMeta);
app.delete('/api/v1/agents/workflows/published-content/:id', authenticate, scopeGuard('write:content', 'write:publish', '*'), deletePublishedContentItem);
app.get('/api/v1/agents/workflows/graph', authenticate, workflowView, scopeGuard('read:agents', '*'), getWorkflowGraphGeneral);
app.get('/api/v1/agents/workflows/escalations', authenticate, workflowView, scopeGuard('read:agents', '*'), getEscalationPaths);
app.get('/api/v1/agents/workflows/approvals', authenticate, workflowView, scopeGuard('read:agents', '*'), getApprovals);
app.get('/api/v1/agents/workflows/approvals/stats', authenticate, workflowView, scopeGuard('read:agents', '*'), getApprovalStats);
app.post('/api/v1/agents/workflows', authenticate, workflowWrite, scopeGuard('write:agents', '*'), createWorkflow);
app.post('/api/v1/agents/workflows/versions/:versionId/submit', authenticate, workflowWrite, scopeGuard('write:agents', '*'), submitForApproval);
app.post('/api/v1/agents/workflows/versions/:versionId/approve', authenticate, workflowApprove, scopeGuard('write:agents', '*'), approveVersion);
app.post('/api/v1/agents/workflows/versions/:versionId/reject', authenticate, workflowApprove, scopeGuard('write:agents', '*'), rejectVersion);
app.post('/api/v1/agents/workflows/versions/:versionId/activate', authenticate, workflowApprove, scopeGuard('write:agents', '*'), activateVersion);
app.post('/api/v1/agents/workflows/versions/:versionId/pause', authenticate, workflowAdmin, scopeGuard('write:agents', '*'), pauseWorkflow);
app.post('/api/v1/agents/workflows/versions/:versionId/retire', authenticate, workflowAdmin, scopeGuard('write:agents', '*'), retireWorkflow);
app.get('/api/v1/agents/workflows/versions/:versionId/graph', authenticate, workflowView, scopeGuard('read:agents', '*'), getWorkflowGraph);
app.post('/api/v1/agents/workflows/versions/:versionId/graph', authenticate, workflowWrite, scopeGuard('write:agents', '*'), saveWorkflowGraph);
app.patch('/api/v1/agents/workflows/steps/:stepId', authenticate, workflowWrite, scopeGuard('write:agents', '*'), saveWorkflowStepConfig);
app.get('/api/v1/agents/workflows/versions/:versionId/validate', authenticate, workflowView, scopeGuard('read:agents', '*'), validateReadiness);
app.post('/api/v1/agents/workflows/versions/:versionId/simulate', authenticate, workflowWrite, scopeGuard('write:agents', '*'), runSimulation);
app.get('/api/v1/agents/workflows/versions/:versionId/simulations', authenticate, workflowView, scopeGuard('read:agents', '*'), listSimulations);
app.post('/api/v1/agents/workflows/instances', authenticate, workflowWrite, scopeGuard('write:agents', '*'), startWorkflowInstance);
app.get('/api/v1/agents/workflows/instances', authenticate, workflowView, scopeGuard('read:agents', '*'), listInstances);
app.get('/api/v1/agents/workflows/instances/:instanceId', authenticate, workflowView, scopeGuard('read:agents', '*'), getInstance);
app.patch('/api/v1/agents/workflows/instances/:instanceId/transition', authenticate, workflowAdmin, scopeGuard('write:agents', '*'), transitionInstance);
app.post('/api/v1/agents/workflows/instances/:instanceId/execute', authenticate, workflowAdmin, scopeGuard('write:agents', '*'), executeWorkflowInstance);
app.get('/api/v1/agents/workflows/instances/:instanceId/step-runs', authenticate, workflowView, scopeGuard('read:agents', '*'), getInstanceStepRuns);
app.get('/api/v1/agents/workflows/instances/:instanceId/evidence', authenticate, workflowView, scopeGuard('read:agents', '*'), getWorkflowEvidence);
app.post('/api/v1/agents/workflows/instances/:instanceId/evidence', authenticate, workflowWrite, scopeGuard('write:agents', '*'), createEvidence);
app.post('/api/v1/agents/workflows/approvals/:approvalId/decide', authenticate, workflowApprove, scopeGuard('write:agents', '*'), recordApproval);
app.get('/api/v1/agents/workflows/:id', authenticate, workflowView, scopeGuard('read:agents', '*'), getWorkflow);
app.patch('/api/v1/agents/workflows/:id', authenticate, workflowWrite, scopeGuard('write:agents', '*'), updateWorkflow);
app.delete('/api/v1/agents/workflows/:id', authenticate, workflowAdmin, scopeGuard('write:agents', '*'), deleteWorkflow);
app.post('/api/v1/agents/workflows/:id/duplicate', authenticate, workflowWrite, scopeGuard('write:agents', '*'), duplicateWorkflow);
app.get('/api/v1/agents/workflows/:id/versions', authenticate, workflowView, scopeGuard('read:agents', '*'), listVersions);
app.post('/api/v1/agents/workflows/:id/versions', authenticate, workflowWrite, scopeGuard('write:agents', '*'), createDraftVersion);
app.post('/api/v1/agents/workflows/:id/rollback', authenticate, workflowAdmin, scopeGuard('write:agents', '*'), rollbackVersion);
app.get('/api/v1/agents/workflows/:id/dependencies', authenticate, workflowView, scopeGuard('read:agents', '*'), getDependencies);

// ─── Export Routes ────────────────────────────────────────────────────────────
app.get('/api/v1/agents/workflows/:id/export', authenticate, workflowView, scopeGuard('read:agents', '*'), exportWorkflow);
app.get('/api/v1/agents/workflows/:id/export/approvals', authenticate, workflowView, scopeGuard('read:agents', '*'), exportApprovals);
app.get('/api/v1/agents/workflows/:id/export/pdf-ready', authenticate, workflowView, scopeGuard('read:agents', '*'), exportPdfReady);
app.get('/api/v1/agents/workflows/:id/export/timeline', authenticate, workflowView, scopeGuard('read:agents', '*'), exportRuntimeTimeline);
app.get('/api/v1/agents/workflows/export/evidence/:evidenceRef', authenticate, workflowView, scopeGuard('read:agents', '*'), exportEvidenceByRef);

// ─── Notification Route ───────────────────────────────────────────────────────
app.post('/api/v1/agents/workflows/:id/notify', authenticate, workflowWrite, scopeGuard('write:agents', '*'), triggerWorkflowNotification);

// ─── Three-Key Approval Routes ────────────────────────────────────────────────
app.get('/api/v1/agents/workflows/three-key/pending/list', authenticate, workflowView, scopeGuard('read:agents', '*'), listPendingThreeKeyChains);
app.get('/api/v1/agents/workflows/three-key/:versionId', authenticate, workflowApprove, scopeGuard('read:agents', '*'), getThreeKeyChain);
app.get('/api/v1/agents/workflows/three-key/:versionId/quorum', authenticate, workflowView, scopeGuard('read:agents', '*'), getThreeKeyQuorum);
app.post('/api/v1/agents/workflows/three-key/:chainId/decide', authenticate, workflowApprove, scopeGuard('write:agents', '*'), recordThreeKeyDecision);

app.get('/api/v1/agents/:id', authenticate, scopeGuard('read:agents', '*'), getAgent);
app.post('/api/v1/agents', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), registerAgent);
app.post('/api/v1/agents/:id/certify', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), certifyAgent);
app.post('/api/v1/agents/:id/sandbox', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), runAgentSandbox);
app.get('/api/v1/agents/:id/sandbox/history', authenticate, scopeGuard('read:agents', '*'), getAgentTestHistory);
app.patch('/api/v1/agents/:id/autonomy', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), updateAutonomy);
app.get('/api/v1/agents/:id/capabilities', authenticate, scopeGuard('read:agents', '*'), getAgentCapabilities);
app.get('/api/v1/agents/:id/versions', authenticate, scopeGuard('read:agents', '*'), getAgentVersions);
app.post('/api/v1/agents/:id/rollback', authenticate, scopeGuard('write:agents', '*'), rollbackAgent);
app.post('/api/v1/agents/:id/test', authenticate, scopeGuard('write:agents', '*'), runAgentSandbox);
app.get('/api/v1/agents/:id/tests', authenticate, scopeGuard('read:agents', '*'), getAgentTestHistory);
app.get('/api/v1/agents/:id/resources', authenticate, scopeGuard('read:agents', '*'), getAgentLinkedResources);
app.patch('/api/v1/agents/:id/resources', authenticate, scopeGuard('write:agents', '*'), updateLinkedResources);
app.get('/api/v1/agents/:id/checklist', authenticate, scopeGuard('read:agents', '*'), getChecklist);
app.get('/api/v1/agents/:id/evidence', authenticate, scopeGuard('read:agents', '*'), getAgentEvidence);
app.get('/api/v1/agents/evidence/:bundleId', authenticate, scopeGuard('read:agents', '*'), getEvidence);

// Agent Lifecycle — Deployment & Retirement
app.post('/api/v1/agents/:id/deploy', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), deployAgent);
app.post('/api/v1/agents/:id/pause', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), pauseAgent);
app.post('/api/v1/agents/:id/resume', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), resumeAgent);
app.post('/api/v1/agents/:id/retire', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), retireAgent);
app.delete('/api/v1/agents/:id', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), hardDeleteAgent);
app.post('/api/v1/agents/:id/clone', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), cloneAgent);
app.post('/api/v1/agents/:id/approval/request', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), requestApproval);
app.post('/api/v1/agents/:id/approval/approve', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), approveAgent);
app.post('/api/v1/agents/:id/approval/reject', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), rejectAgentApproval);
app.patch('/api/v1/agents/:id/runtime', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), updateRuntimeControls);

// Agent Studio Extended Routes — Profile, Templates, Permission Sets, Safety, Platform, Incidents
app.patch('/api/v1/agents/:id/update', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), updateAgent);
app.get('/api/v1/agents/templates', authenticate, scopeGuard('read:agents', '*'), listAgentTemplates);
app.get('/api/v1/agents/templates/:id', authenticate, scopeGuard('read:agents', '*'), getAgentTemplate);
app.post('/api/v1/agents/from-template', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), createAgentFromTemplate);
app.get('/api/v1/agents/:id/profile', authenticate, scopeGuard('read:agents', '*'), getAgentProfile);
app.get('/api/v1/agents/:id/governance-gates', authenticate, scopeGuard('read:agents', '*'), getAgentGovernanceGates);
app.get('/api/v1/agents/:id/permissions', authenticate, scopeGuard('read:agents', '*'), getAgentPermissionSets);
app.patch('/api/v1/agents/:id/permissions', authenticate, agentStudioGuard, scopeGuard('write:agents', '*'), updateAgentPermissionSets);
app.post('/api/v1/agents/:id/safety-checks/run', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), runAgentSafetyChecks);
app.get('/api/v1/agents/:id/safety-checks', authenticate, scopeGuard('read:agents', '*'), getAgentSafetyResults);
app.post('/api/v1/agents/:id/platform-checks/run', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), runAgentPlatformChecks);
app.get('/api/v1/agents/:id/platform-checks', authenticate, scopeGuard('read:agents', '*'), getAgentPlatformCheckHistory);
app.get('/api/v1/agents/:id/incidents', authenticate, scopeGuard('read:agents', '*'), getAgentIncidents);
app.post('/api/v1/agents/:id/incidents', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), createAgentIncident);
app.patch('/api/v1/agents/:id/incidents/:incidentId/resolve', authenticate, agentOpsGuard, scopeGuard('write:agents', '*'), resolveAgentIncident);

// Agent Operations Routes
// Defense in depth: requireOperationsAccess guarantees every operations route
// requires at least base "view" permission at the route layer. Each handler
// additionally enforces its specific action via assertOperationsPermission +
// assertWorkspaceScope. All access uses the Supabase service role; tenant
// isolation is enforced in the API layer.
app.use('/api/v1/operations', authenticate, agentOpsGuard, requireOperationsAccess);
app.get('/api/v1/operations/runs', authenticate, listAgentRuns);
app.get('/api/v1/operations/events', authenticate, subscribeOperationsEvents);
app.get('/api/v1/operations/runs/:id', authenticate, getAgentRun);
app.get('/api/v1/operations/runs/:id/timeline', authenticate, getRunTimeline);
app.post('/api/v1/operations/runs/:id/pause', authenticate, pauseRun);
app.post('/api/v1/operations/runs/:id/resume', authenticate, resumeRun);
app.post('/api/v1/operations/runs/:id/start', authenticate, startRun);
app.delete('/api/v1/operations/runs/:id', authenticate, deleteRun);
app.post('/api/v1/operations/runs/:id/stop', authenticate, stopRun);
app.post('/api/v1/operations/runs/:id/retry', authenticate, retryRun);
app.post('/api/v1/operations/runs/:id/quarantine', authenticate, quarantineRun);
app.get('/api/v1/operations/queues', authenticate, listQueues);
app.post('/api/v1/operations/queues/:id/assign', authenticate, assignQueueItem);
app.post('/api/v1/operations/queues/:id/resolve', authenticate, resolveQueueItem);
app.post('/api/v1/operations/incidents', authenticate, createIncident);
app.get('/api/v1/operations/incidents', authenticate, listIncidents);
app.patch('/api/v1/operations/incidents/:id/resolve', authenticate, resolveIncident);
app.post('/api/v1/operations/incidents/:id/postmortem', authenticate, generatePostmortem);
app.get('/api/v1/operations/incidents/:id/postmortem', authenticate, getPostmortem);
app.get('/api/v1/operations/stats', authenticate, cache(30), getOperationsStats);
app.get('/api/v1/operations/evidence/:bundleId', authenticate, getRunEvidence);
app.post('/api/v1/operations/evidence/:bundleId/export', authenticate, exportEvidence);
app.post('/api/v1/operations/runs/:id/emergency-pause', authenticate, emergencyPause);
app.post('/api/v1/operations/runs/:id/hold', authenticate, holdRun);
app.post('/api/v1/operations/runs/:id/release-hold', authenticate, releaseHoldRun);
app.post('/api/v1/operations/runs/:id/escalate', authenticate, escalateRun);
app.post('/api/v1/operations/runs/:id/restricted-mode', authenticate, restrictedMode);
app.post('/api/v1/operations/runs/:id/policy-check', authenticate, runPolicyCheck);
app.get('/api/v1/operations/runs/:id/policy-results', authenticate, getPolicyResults);
app.get('/api/v1/operations/runs/:id/control-log', authenticate, getRuntimeControlLog);
app.get('/api/v1/operations/analytics', authenticate, getAnalyticsMetrics);
app.post('/api/v1/operations/analytics/export', authenticate, exportAnalyticsCSV);
app.post('/api/v1/operations/runs/:id/export-output', authenticate, exportOutputSnapshot);
app.post('/api/v1/operations/evidence', authenticate, createEvidenceBundle);
app.post('/api/v1/operations/evidence/:bundleId/lock', authenticate, lockEvidenceBundle);
app.get('/api/v1/operations/evidence', authenticate, listEvidenceBundles);

// Monitoring Routes
app.get('/api/v1/monitoring/usage',         authenticate, scopeGuard('read:analytics', '*'), getResourceUsage);
app.get('/api/v1/monitoring/quota',         authenticate, scopeGuard('read:analytics', '*'), getTokenQuota);
app.get('/api/v1/monitoring/storage-quota', authenticate, scopeGuard('read:analytics', '*'), getStorageQuota);
app.post('/api/v1/monitoring/storage-addon', authenticate, purchaseStorageAddon);

// Billing & Wallet
app.use('/api/v1/billing/webhook', express.raw({ type: 'application/json' }));
app.post('/api/v1/billing/webhook', stripeWebhook);
app.post('/api/v1/billing/trial/start',      authenticate, billingGuard, startTrial);
app.get('/api/v1/billing/status',            authenticate, billingGuard, getBillingStatus);
app.get('/api/v1/billing/wallet',            authenticate, billingGuard, getWalletData);
app.get('/api/v1/billing/wallet/balance',    authenticate, billingGuard, getWalletBalance);
app.put('/api/v1/billing/wallet/auto-topup', authenticate, billingGuard, updateAutoTopup);
app.post('/api/v1/billing/fees',             authenticate, billingGuard, calculateFees);
app.post('/api/v1/billing/deposit/create',        authenticate, billingGuard, createDepositSession);
app.post('/api/v1/billing/deposit/simulate',      authenticate, billingGuard, simulateDeposit);
app.post('/api/v1/billing/deposit/sync-session',  authenticate, billingGuard, syncDepositSession);
app.get('/api/v1/billing/spend-cap',         authenticate, billingGuard, getSpendCap);
app.patch('/api/v1/billing/spend-cap',       authenticate, billingGuard, updateSpendCap);
app.get('/api/v1/billing/overcharge',        authenticate, billingGuard, getOvercharge);
app.patch('/api/v1/billing/overcharge',      authenticate, billingGuard, updateOvercharge);
app.get('/api/v1/billing/settings',          authenticate, billingGuard, getBillingSettings);
app.patch('/api/v1/billing/settings',        authenticate, billingGuard, updateBillingSettings);
app.post('/api/v1/billing/payment-methods/setup',          authenticate, billingGuard, createSetupIntent);
app.post('/api/v1/billing/payment-methods/setup-checkout', authenticate, billingGuard, createSetupCheckout);
app.post('/api/v1/billing/payment-methods/sync-session',   authenticate, billingGuard, syncCardSession);
app.get('/api/v1/billing/payment-methods',                 authenticate, billingGuard, listPaymentMethods);
app.delete('/api/v1/billing/payment-methods/:id',          authenticate, billingGuard, deletePaymentMethod);
app.post('/api/v1/billing/payment-methods/:id/default',    authenticate, billingGuard, setDefaultPaymentMethod);
app.post('/api/v1/billing/subscribe',          authenticate, billingGuard, createSubscription);
app.post('/api/v1/billing/cancel-subscription', authenticate, billingGuard, cancelSubscription);
app.get('/api/v1/billing/subscription',        authenticate, billingGuard, getSubscription);
app.get('/api/v1/billing/invoices',            authenticate, billingGuard, listInvoices);
app.get('/api/v1/monitoring/models/performance/summary', authenticate, systemStatusGuard, scopeGuard('read:analytics', '*'), getPerformanceSummary);
app.get('/api/v1/monitoring/models/performance/trends', authenticate, systemStatusGuard, scopeGuard('read:analytics', '*'), getPerformanceTrends);
app.get('/api/v1/monitoring/models/performance/hallucinations', authenticate, systemStatusGuard, scopeGuard('read:analytics', '*'), getHallucinationFlags);
app.get('/api/v1/monitoring/models/performance/agents', authenticate, systemStatusGuard, scopeGuard('read:analytics', '*'), getAgentLeaderboard);

// SuperAdmin Routes (superadmin-only)
const superAdminGuard = requireRole('SUPERADMIN');
app.get('/api/v1/superadmin/organizations', authenticate, superAdminGuard, SuperAdminController.listAllOrganizations);
app.post('/api/v1/superadmin/organizations', authenticate, superAdminGuard, SuperAdminController.createOrganization);
app.post('/api/v1/superadmin/organizations/:orgId/approve', authenticate, superAdminGuard, SuperAdminController.approveOrganization);
app.post('/api/v1/superadmin/organizations/:orgId/pause', authenticate, superAdminGuard, SuperAdminController.pauseOrganization);
app.post('/api/v1/superadmin/organizations/:orgId/resume', authenticate, superAdminGuard, SuperAdminController.resumeOrganization);
app.post('/api/v1/superadmin/organizations/:orgId/restrict', authenticate, superAdminGuard, SuperAdminController.restrictOrganization);
app.post('/api/v1/superadmin/organizations/:orgId/restore', authenticate, superAdminGuard, SuperAdminController.restoreOrganization);
app.put('/api/v1/superadmin/organizations/:orgId/plan', authenticate, superAdminGuard, SuperAdminController.upgradeOrganizationPlan);
app.delete('/api/v1/superadmin/organizations/:orgId', authenticate, superAdminGuard, SuperAdminController.deleteOrganization);
app.get('/api/v1/superadmin/analytics', authenticate, superAdminGuard, SuperAdminController.getAnalytics);
app.get('/api/v1/superadmin/stats', authenticate, superAdminGuard, SuperAdminController.getPlatformStats);
app.get('/api/v1/superadmin/tickets', authenticate, superAdminGuard, SupportController.listAllTickets);
app.get('/api/v1/superadmin/tickets/count', authenticate, superAdminGuard, SupportController.countOpenTickets);
app.patch('/api/v1/superadmin/tickets/:id', authenticate, superAdminGuard, SupportController.updateTicketStatus);

// Knowledge Base Routes — Governed Knowledge Layer
// ─── Knowledge RBAC gate ─────────────────────────────────────────────────────
app.use('/api/v1/knowledge', authenticate, knowledgeBaseGuard);
// Legacy endpoints (backward compat)
app.get('/api/v1/knowledge/bases', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listBases);
app.post('/api/v1/knowledge/bases', authenticate, scopeGuard('write:content', '*'), KnowledgeController.createBase);
app.delete('/api/v1/knowledge/bases/:baseId', authenticate, scopeGuard('write:content', '*'), KnowledgeController.deleteBase);
app.get('/api/v1/knowledge/bases/:baseId/entries', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listEntries);
app.post('/api/v1/knowledge/bases/:baseId/entries', authenticate, scopeGuard('write:content', '*'), upload.single('file'), KnowledgeController.createEntry);
app.put('/api/v1/knowledge/entries/:entryId', authenticate, scopeGuard('write:content', '*'), KnowledgeController.updateEntry);
app.delete('/api/v1/knowledge/entries/:entryId', authenticate, scopeGuard('write:content', '*'), KnowledgeController.deleteEntry);
app.get('/api/v1/knowledge/ai-context', authenticate, scopeGuard('read:content', '*'), KnowledgeController.getAIContext);

// Collections API (governed)
app.get('/api/v1/knowledge/collections', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listCollections);
app.get('/api/v1/knowledge/collections/:id', authenticate, scopeGuard('read:content', '*'), KnowledgeController.getCollection);
app.post('/api/v1/knowledge/collections', authenticate, scopeGuard('write:content', '*'), KnowledgeController.createCollection);
app.patch('/api/v1/knowledge/collections/:id', authenticate, scopeGuard('write:content', '*'), KnowledgeController.updateCollection);
app.delete('/api/v1/knowledge/collections/:id', authenticate, scopeGuard('write:content', '*'), KnowledgeController.deleteCollection);

// Sources API (governed)
app.get('/api/v1/knowledge/sources', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listSources);
app.get('/api/v1/knowledge/sources/:id', authenticate, scopeGuard('read:content', '*'), KnowledgeController.getSource);
app.post('/api/v1/knowledge/collections/:collectionId/sources', authenticate, scopeGuard('write:content', '*'), upload.single('file'), KnowledgeController.createSource);
app.patch('/api/v1/knowledge/sources/:id', authenticate, scopeGuard('write:content', '*'), KnowledgeController.updateSource);
app.delete('/api/v1/knowledge/sources/:id', authenticate, scopeGuard('write:content', '*'), KnowledgeController.deleteSource);

// Source lifecycle management
app.post('/api/v1/knowledge/entries/:id/approve', authenticate, scopeGuard('write:content', '*'), KnowledgeController.approveSource);
app.post('/api/v1/knowledge/entries/:id/reject', authenticate, scopeGuard('write:content', '*'), KnowledgeController.rejectSource);
app.post('/api/v1/knowledge/entries/:id/retire', authenticate, scopeGuard('write:content', '*'), KnowledgeController.retireSource);
app.post('/api/v1/knowledge/sources/:id/approve', authenticate, scopeGuard('write:content', '*'), KnowledgeController.approveSource);
app.post('/api/v1/knowledge/sources/:id/reject', authenticate, scopeGuard('write:content', '*'), KnowledgeController.rejectSource);
app.post('/api/v1/knowledge/sources/:id/retire', authenticate, scopeGuard('write:content', '*'), KnowledgeController.retireSource);
app.post('/api/v1/knowledge/sources/:id/activate', authenticate, scopeGuard('write:content', '*'), KnowledgeController.activateSource);
app.post('/api/v1/knowledge/sources/:id/publish', authenticate, scopeGuard('write:content', '*'), KnowledgeController.publishSource);
app.post('/api/v1/knowledge/sources/:id/restrict', authenticate, scopeGuard('write:content', '*'), KnowledgeController.restrictSource);
app.post('/api/v1/knowledge/sources/:id/quarantine', authenticate, scopeGuard('write:content', '*'), KnowledgeController.quarantineSource);
app.post('/api/v1/knowledge/sources/:id/classify-governance', authenticate, scopeGuard('write:content', '*'), KnowledgeController.classifySourceGovernance);
app.post('/api/v1/knowledge/sources/:id/governance-decision', authenticate, scopeGuard('write:content', '*'), KnowledgeController.decideGovernanceCategory);
app.post('/api/v1/knowledge/sources/:id/transfer/decision', authenticate, scopeGuard('write:content', '*'), KnowledgeController.decideSourceTransfer);

// Stats
app.get('/api/v1/knowledge/stats', authenticate, scopeGuard('read:content', '*'), KnowledgeController.getStats);

// Conflicts API
app.get('/api/v1/knowledge/conflicts', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listConflicts);

app.get('/api/v1/integrations/health', authenticate, developerGuard, scopeGuard('read:analytics', '*'), getIntegrationHealth);

// ─── Integration Management (DEVELOPER / ADMIN / WORKSPACE_OWNER, Growth+ plan, dashboard-only) ───
const integGuard = requireRole('DEVELOPER', 'WORKSPACE_OWNER', 'ADMIN');

// API Keys Routes
app.get('/api/v1/integrations/api-keys', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, listApiKeys);
app.post('/api/v1/integrations/api-keys', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, createApiKey);
app.patch('/api/v1/integrations/api-keys/:id/revoke', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, revokeApiKey);
app.delete('/api/v1/integrations/api-keys/:id', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, deleteApiKey);

// Webhook Routes
app.get('/api/v1/integrations/webhooks', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, listWebhooks);
app.post('/api/v1/integrations/webhooks', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, createWebhook);
app.patch('/api/v1/integrations/webhooks/:id', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, updateWebhook);
app.delete('/api/v1/integrations/webhooks/:id', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, deleteWebhook);
app.post('/api/v1/integrations/webhooks/:id/test', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, testWebhook);
app.get('/api/v1/integrations/webhooks/:id/logs', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, getDeliveryLogs);

// Data Connectors Routes
app.get('/api/v1/integrations/connectors', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, listConnectors);
app.post('/api/v1/integrations/connectors', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, requireBillingExecution('connector_write'), createConnector);
app.delete('/api/v1/integrations/connectors/:id', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, deleteConnector);
app.post('/api/v1/integrations/connectors/:id/sync', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, triggerSync);
app.get('/api/v1/integrations/connectors/:id/logs', authenticate, blockApiKeyUsers, integrationPlanGate, integGuard, getSyncLogs);

// Approval Workflow Routes (DEPRECATED — use /api/v1/approvals-v2/* instead)
function deprecate(req: any, res: any, next: any) {
  res.set('X-API-Deprecated', '/api/v1/approvals-v2');
  next();
}
app.post('/api/v1/approvals/submit', authenticate, deprecate, scopeGuard('write:publish', '*'), submitForReview);
app.get('/api/v1/approvals/queue', authenticate, deprecate, scopeGuard('read:governance', '*'), getApprovalQueue);
app.get('/api/v1/approvals/stats', authenticate, deprecate, scopeGuard('read:governance', '*'), getApprovalStatsLegacy);
app.post('/api/v1/approvals/items/:id/action', authenticate, deprecate, scopeGuard('write:publish', '*'), takeApprovalAction);

// ─── Approval Workbench Routes (v2 — Full 3-Panel Wireframe) ────────────
app.post('/api/v1/approvals-v2/items', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), createApprovalItem);
app.get('/api/v1/approvals-v2/items', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), listApprovalItems);
app.get('/api/v1/approvals-v2/items/:id', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getV2ApprovalItem);
app.get('/api/v1/approvals-v2/stats', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getV2ApprovalStats);
app.get('/api/v1/approvals-v2/items/:id/eligibility', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getApprovalEligibility);
app.post('/api/v1/approvals-v2/items/:id/action', authenticate, approvalConsoleGuard, scopeGuard('write:publish', '*'), takeV2ApprovalAction);
app.patch('/api/v1/approvals-v2/items/:id/assign', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), assignApprover);
app.patch('/api/v1/approvals-v2/items/:id/reassign', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), reassignApprover);
app.get('/api/v1/approvals-v2/items/:id/path', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getApprovalPath);
app.post('/api/v1/approvals-v2/items/:id/path', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), createApprovalPathHandler);
app.get('/api/v1/approvals-v2/items/:id/decisions', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getApprovalDecisions);
app.get('/api/v1/approvals-v2/items/:id/comments', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getApprovalComments);
app.post('/api/v1/approvals-v2/items/:id/comments', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), addApprovalComment);
app.get('/api/v1/approvals-v2/items/:id/evidence', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getApprovalEvidence);
app.post('/api/v1/approvals-v2/items/:id/evidence', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), addApprovalEvidence);
app.get('/api/v1/approvals-v2/items/:id/audit-log', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), getApprovalAuditTrail);
app.post('/api/v1/approvals-v2/items/:id/export', authenticate, approvalConsoleGuard, scopeGuard('read:governance', '*'), exportApprovalRecord);
app.post('/api/v1/approvals-v2/callbacks/:callbackId/retry', authenticate, approvalConsoleGuard, scopeGuard('write:governance', '*'), retryCallback);
app.post('/api/v1/approvals-v2/bulk/:action', authenticate, approvalConsoleGuard, scopeGuard('write:publish', '*'), bulkApprovalAction);

app.get('/api/v1/knowledge/conflicts/:id', authenticate, scopeGuard('read:content', '*'), KnowledgeController.getConflict);
app.post('/api/v1/knowledge/conflicts', authenticate, scopeGuard('write:content', '*'), KnowledgeController.createConflict);
app.post('/api/v1/knowledge/conflicts/:id/resolve', authenticate, scopeGuard('write:content', '*'), KnowledgeController.resolveConflict);

// Retrieval Logs API
app.get('/api/v1/knowledge/retrieval-logs', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listRetrievalLogs);
app.post('/api/v1/knowledge/retrieval-logs', authenticate, scopeGuard('write:content', '*'), KnowledgeController.logRetrievalEvent);

// Reviews API
app.get('/api/v1/knowledge/reviews', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listReviews);

// Chunks API
app.get('/api/v1/knowledge/sources/:sourceId/chunks', authenticate, scopeGuard('read:content', '*'), KnowledgeController.listChunks);

// Search API
app.get('/api/v1/knowledge/search', authenticate, scopeGuard('read:content', '*'), KnowledgeController.searchSources);

// Access Policy API
app.get('/api/v1/knowledge/access-policy', authenticate, scopeGuard('read:content', '*'), KnowledgeController.getAccessPolicy);
app.post('/api/v1/knowledge/access-policy', authenticate, scopeGuard('write:content', '*'), KnowledgeController.upsertAccessPolicy);

// ─── Prompt Governance RBAC Guards ───────────────────────────────────────
// All prompt governance ops restricted to GOVERNANCE_ADMIN + AGENT_ARCHITECT (+ admin tiers)
const govView      = promptsGuard;
const govEdit      = promptsGuard;
const govLifecycle = promptsGuard;

// ─── Prompt Governance Routes ────────────────────────────────────────────
// Static routes (must come before parameterized :id routes)
app.get('/api/v1/prompts/stats', authenticate, govView, PromptController.getPromptStats);
app.get('/api/v1/prompts/approvals/stats', authenticate, govView, PromptController.getApprovalStats);
// Append-only audit trail — single record lookup (static, before :id routes)
app.get('/api/v1/prompts/audit/:auditId', authenticate, govView, PromptController.getAuditEntry);
// Reverse dependency traversal (static, MUST precede /prompts/:id to avoid shadowing)
app.get('/api/v1/prompts/dependents', authenticate, govView, PromptController.getPromptDependents);
// Dependency notification plan (static, MUST precede /prompts/:id to avoid shadowing)
app.get('/api/v1/prompts/dependency-notifications/plan', authenticate, govView, PromptController.getDependencyNotificationPlan);
// Governance dashboard rollup (static, MUST precede /prompts/:id to avoid shadowing)
app.get('/api/v1/prompts/governance-dashboard', authenticate, govView, PromptController.getGovernanceDashboard);
// Runtime trace ingestion (static, MUST precede /prompts/:id). Service-authenticated
// via API key scope; JWT users are role-gated inside the handler.
app.post('/api/v1/prompts/runtime-traces', authenticate, govEdit, scopeGuard('write:prompt_runtime_trace'), PromptController.ingestRuntimeTrace);
// Incident detail/update/close (static incidents/:incidentId, MUST precede /prompts/:id).
app.get('/api/v1/prompts/incidents/:incidentId', authenticate, govView, PromptController.getIncident);
app.patch('/api/v1/prompts/incidents/:incidentId', authenticate, govLifecycle, PromptController.updateIncident);
app.post('/api/v1/prompts/incidents/:incidentId/close', authenticate, govLifecycle, PromptController.closeIncident);

// Versions sub-routes (no :id prefix)
app.post('/api/v1/prompts/versions/:versionId/approve', authenticate, govLifecycle, PromptController.approveVersion);
app.post('/api/v1/prompts/versions/:versionId/reject', authenticate, govLifecycle, PromptController.rejectVersion);
// A6 — Waive outstanding review requirements with justification (admin override gated in-handler)
app.post('/api/v1/prompts/versions/:versionId/waive', authenticate, govLifecycle, PromptController.waiveApproval);
app.post('/api/v1/prompts/versions/:versionId/deploy', authenticate, govLifecycle, PromptController.deployVersion);
app.get('/api/v1/prompts/versions/:versionId/tests/runs', authenticate, govView, PromptController.listTestRuns);
app.post('/api/v1/prompts/versions/:versionId/tests/run', authenticate, govEdit, PromptController.runTests);
app.get('/api/v1/prompts/versions/:versionId/approvals', authenticate, govView, PromptController.listApprovals);
app.get('/api/v1/prompts/versions/:versionId/deployments', authenticate, govView, PromptController.listDeployments);
app.get('/api/v1/prompts/versions/:versionId/bindings', authenticate, govEdit, PromptController.listBindings);
app.post('/api/v1/prompts/versions/:versionId/bindings', authenticate, govEdit, PromptController.createBinding);
app.get('/api/v1/prompts/versions/:versionId/knowledge', authenticate, govEdit, PromptController.listKnowledgeBindings);
app.post('/api/v1/prompts/versions/:versionId/knowledge', authenticate, govEdit, PromptController.createKnowledgeBinding);
app.get('/api/v1/prompts/versions/:versionId/tools', authenticate, govEdit, PromptController.listToolPermissions);
app.post('/api/v1/prompts/versions/:versionId/tools', authenticate, govEdit, PromptController.createToolPermission);
app.get('/api/v1/prompts/versions/:versionId/graph', authenticate, govView, PromptController.getPromptVersionGraph);
app.get('/api/v1/prompts/versions/:versionId/dependency-health', authenticate, govView, PromptController.getPromptVersionDependencyHealth);
app.get('/api/v1/prompts/versions/:versionId/impact', authenticate, govView, PromptController.getPromptVersionImpact);
app.get('/api/v1/prompts/versions/:versionId/runtime-traces', authenticate, govView, PromptController.listVersionRuntimeTraces);
// Dependency binding edits (update / delete) — addressed by binding id, tenant-scoped
app.patch('/api/v1/prompts/bindings/:bindingId', authenticate, govEdit, PromptController.updateBinding);
app.delete('/api/v1/prompts/bindings/:bindingId', authenticate, govEdit, PromptController.deleteBinding);
app.patch('/api/v1/prompts/knowledge-bindings/:bindingId', authenticate, govEdit, PromptController.updateKnowledgeBinding);
app.delete('/api/v1/prompts/knowledge-bindings/:bindingId', authenticate, govEdit, PromptController.deleteKnowledgeBinding);
app.patch('/api/v1/prompts/tool-permissions/:permissionId', authenticate, govEdit, PromptController.updateToolPermission);
app.delete('/api/v1/prompts/tool-permissions/:permissionId', authenticate, govEdit, PromptController.deleteToolPermission);

// Prompt CRUD (parameterized :id routes)
app.get('/api/v1/prompts', authenticate, govView, PromptController.listPrompts);
app.post('/api/v1/prompts', authenticate, govEdit, PromptController.createPrompt);
// A1 — Import a prompt definition (static, MUST precede /prompts/:id routes)
app.post('/api/v1/prompts/import', authenticate, govEdit, PromptController.importPrompt);
app.get('/api/v1/prompts/:id', authenticate, govView, PromptController.getPrompt);
app.get('/api/v1/prompts/:id/graph', authenticate, govView, PromptController.getPromptGraph);
app.get('/api/v1/prompts/:id/dependency-health', authenticate, govView, PromptController.getPromptDependencyHealth);
app.get('/api/v1/prompts/:id/impact', authenticate, govView, PromptController.getPromptImpact);
app.get('/api/v1/prompts/:id/governance-snapshot', authenticate, govView, PromptController.getPromptGovernanceSnapshot);
app.patch('/api/v1/prompts/:id', authenticate, govEdit, PromptController.updatePrompt);
app.post('/api/v1/prompts/:id/clone', authenticate, govEdit, PromptController.clonePrompt);
// A1 — Create a new draft from an approved prompt used as a template
app.post('/api/v1/prompts/:id/template', authenticate, govEdit, PromptController.createFromTemplate);

// Lifecycle actions
app.post('/api/v1/prompts/:id/pause', authenticate, govLifecycle, PromptController.pausePrompt);
app.post('/api/v1/prompts/:id/resume', authenticate, govLifecycle, PromptController.resumePrompt);
app.post('/api/v1/prompts/:id/archive', authenticate, govLifecycle, PromptController.archivePrompt);
app.post('/api/v1/prompts/:id/retire', authenticate, govLifecycle, PromptController.retirePrompt);
app.post('/api/v1/prompts/:id/reactivate', authenticate, govLifecycle, PromptController.reactivatePrompt);
app.post('/api/v1/prompts/:id/submit-review', authenticate, govLifecycle, PromptController.submitForReview);
app.post('/api/v1/prompts/:id/rollback', authenticate, govLifecycle, PromptController.rollbackPrompt);

// Evidence Vault — immutable evidence chain for a prompt
app.get('/api/v1/prompts/:id/evidence', authenticate, govView, PromptController.listPromptEvidence);

// Evidence Export — sealed, reason-stamped export package (permission-gated)
app.post('/api/v1/prompts/:id/evidence/export', authenticate, govView, PromptController.createPromptEvidenceExport);
app.get('/api/v1/prompts/:id/evidence/export/:exportId', authenticate, govView, PromptController.getPromptEvidenceExport);

// Runtime Evidence — runtime traces for a prompt (read-only, workspace-scoped)
app.get('/api/v1/prompts/:id/runtime-traces', authenticate, govView, PromptController.listPromptRuntimeTraces);

// Prompt Incidents — open (governance roles) + list (workspace-scoped)
app.post('/api/v1/prompts/:id/incidents', authenticate, govLifecycle, PromptController.createIncident);
app.get('/api/v1/prompts/:id/incidents', authenticate, govView, PromptController.listPromptIncidents);

// Append-only Audit Trail — governance ledger for a prompt (read-only)
app.get('/api/v1/prompts/:id/audit', authenticate, govView, PromptController.listPromptAudit);
app.get('/api/v1/prompts/:id/audit/timeline', authenticate, govView, PromptController.getPromptAuditTimeline);

// Versions (under :id)
app.get('/api/v1/prompts/:id/versions', authenticate, govView, PromptController.listVersions);
app.post('/api/v1/prompts/:id/versions', authenticate, govEdit, PromptController.createVersion);
app.get('/api/v1/prompts/:id/versions/:versionId', authenticate, govView, PromptController.getVersion);

// Tests (under :id)
app.get('/api/v1/prompts/:id/tests/suites', authenticate, govView, PromptController.listTestSuites);
app.post('/api/v1/prompts/:id/tests/suites', authenticate, govEdit, PromptController.createTestSuite);

// Drift Monitoring (Phase 5B) — on-demand governance compliance analysis
app.post('/api/v1/prompts/:id/drift/scan', authenticate, govView, PromptController.scanPromptDrift);
app.get('/api/v1/prompts/drift/summary', authenticate, govView, PromptController.getDriftSummary);
app.post('/api/v1/prompts/drift/resolve', authenticate, govLifecycle, PromptController.resolveDrift);

// Adversarial Testing (Phase 5C) — deterministic attack-surface analysis
app.get('/api/v1/prompts/:id/tests/suites/:suiteId/adversarial/scenarios', authenticate, govView, PromptController.listAdversarialScenarios);
app.post('/api/v1/prompts/:id/tests/suites/:suiteId/adversarial/scenarios', authenticate, govEdit, PromptController.createAdversarialScenario);
app.put('/api/v1/prompts/:id/tests/suites/:suiteId/adversarial/scenarios/:scenarioId', authenticate, govEdit, PromptController.updateAdversarialScenario);
app.delete('/api/v1/prompts/:id/tests/suites/:suiteId/adversarial/scenarios/:scenarioId', authenticate, govEdit, PromptController.deleteAdversarialScenario);
app.post('/api/v1/prompts/:id/tests/suites/:suiteId/adversarial/scenarios/seed', authenticate, govEdit, PromptController.seedDefaultAdversarialScenarios);
app.post('/api/v1/prompts/versions/:versionId/tests/adversarial/run', authenticate, govEdit, PromptController.runAdversarialTests);
app.get('/api/v1/prompts/versions/:versionId/tests/adversarial/runs', authenticate, govView, PromptController.listAdversarialResults);
app.get('/api/v1/prompts/versions/:versionId/tests/adversarial/runs/:runId', authenticate, govView, PromptController.getAdversarialResultDetail);
// Phase 6.2 — Real adversarial attack execution
app.post('/api/v1/prompts/versions/:versionId/tests/adversarial/real', authenticate, govEdit, PromptController.runRealAdversarialSuite);

// Test Center — runtime governance classifier (post description → APPROVE/REVIEW/BLOCK)
app.post('/api/v1/prompts/test-center/classify', authenticate, govView, PromptController.classifyTestDescription);

// Policy Simulation (Phase 5D) — read-only what-if analysis
app.post('/api/v1/prompts/simulate', authenticate, govView, PromptController.runPolicySimulation);
app.post('/api/v1/prompts/:id/simulate', authenticate, govView, PromptController.runPromptPolicySimulation);

// Prompt Scorecards (Phase 5E) — structured health scores
app.get('/api/v1/prompts/scorecards', authenticate, govView, PromptController.listPromptScorecards);
app.get('/api/v1/prompts/:id/scorecard', authenticate, govView, PromptController.getPromptScorecard);

// Governance Metrics Dashboard (Phase 5F) — lean live-computed pipeline
app.get('/api/v1/prompts/metrics/dashboard', authenticate, govView, PromptController.getGovernanceMetrics);

// Evaluation Intelligence Dashboard Views (Phase 6.5)
app.get('/api/v1/prompts/dashboard/evaluation', authenticate, govView, PromptController.getEvaluationView);
app.get('/api/v1/prompts/dashboard/adversarial', authenticate, govView, PromptController.getAdversarialView);
app.get('/api/v1/prompts/dashboard/drift', authenticate, govView, PromptController.getDriftView);

// ─── Prompt Evaluation (Phase 1) ─────────────────────────────────────
app.post('/api/v1/prompts/versions/:versionId/evaluate', authenticate, govLifecycle, PromptController.evaluatePromptVersion);

// ─── Constraint Shadow (Phase 2) ─────────────────────────────────────
app.get('/api/v1/prompts/:id/constraint-shadow', authenticate, govView, PromptController.getConstraintShadow);
app.post('/api/v1/prompts/:id/constraint-shadow/lock', authenticate, govLifecycle, PromptController.lockConstraintShadow);

// ─── Variable Management (Phase 2) ───────────────────────────────────
app.get('/api/v1/prompts/versions/:versionId/variables', authenticate, govView, PromptController.getPromptVariables);
app.put('/api/v1/prompts/versions/:versionId/variables', authenticate, govEdit, PromptController.updatePromptVariables);
app.post('/api/v1/prompts/versions/:versionId/variables/validate', authenticate, govView, PromptController.validatePromptVariables);

// ─── Guardrail Authoring (A2) ────────────────────────────────────────
app.put('/api/v1/prompts/versions/:versionId/guardrails', authenticate, govEdit, PromptController.updatePromptGuardrails);

// ─── Parameter Policy (Phase 2) ──────────────────────────────────────
app.post('/api/v1/prompts/:id/parameter-policy/evaluate', authenticate, govView, PromptController.evaluateParameterPolicy);

// ─── Runtime Variable Governance (Phase 2) ───────────────────────────
app.post('/api/v1/prompts/versions/:versionId/runtime-governance', authenticate, govEdit, PromptController.enforceRuntimeGovernance);

// ─── Prompt Defensibility Index / PDI (Phase 3) ──────────────────────
app.get('/api/v1/prompts/:id/pdi', authenticate, govView, PromptController.computePDI);

// Phase 6.3 — Real cross-model evaluation (4 providers, 6 metrics)
app.post('/api/v1/prompts/versions/:versionId/cross-model/real', authenticate, govView, PromptController.runRealCrossModelComparison);

// ─── Governance Receipt (Phase 4) ────────────────────────────────────
app.post('/api/v1/prompts/:id/receipt', authenticate, govLifecycle, PromptController.generateGovernanceReceipt);

// ─── Commissioning (Phase 5) ─────────────────────────────────────────
app.post('/api/v1/prompts/:id/commission/preflight', authenticate, govLifecycle, PromptController.runCommissionPreflight);
app.post('/api/v1/prompts/:id/commission', authenticate, govLifecycle, PromptController.commissionPrompt);

// ─── Separation of Duties (Phase 7) ──────────────────────────────────
app.post('/api/v1/prompts/versions/:versionId/sod/check', authenticate, govView, PromptController.checkSeparationOfDuties);

// ─── Delegation (Phase 7) ────────────────────────────────────────────
app.post('/api/v1/prompts/versions/:versionId/delegate', authenticate, govEdit, PromptController.delegateApproval);

// ─── Escalation (Phase 7) ────────────────────────────────────────────
app.post('/api/v1/prompts/versions/:versionId/escalate', authenticate, govEdit, PromptController.escalateApproval);

// ─── Three-Key Approval (Phase 7) ────────────────────────────────────
app.post('/api/v1/prompts/versions/:versionId/three-key/initialize', authenticate, govLifecycle, PromptController.initializeThreeKey);
app.post('/api/v1/prompts/versions/:versionId/three-key/submit', authenticate, govLifecycle, PromptController.submitThreeKey);
app.get('/api/v1/prompts/versions/:versionId/three-key/status', authenticate, govView, PromptController.getThreeKeyStatus);

// ─── Per-version sealed hash history (read-only, Phase 5.C) ──────────────
app.get('/api/v1/prompts/versions/:versionId/sealed-history', authenticate, govView, PromptController.getVersionSealedHistory);

// ─── Approval Rules Routes ───────────────────────────────────────────
app.get('/api/v1/governance/rules', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), listRules);
app.post('/api/v1/governance/rules', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), createRule);
app.post('/api/v1/governance/rules/ai-suggest', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), suggestKeywords);
app.get('/api/v1/governance/rules/stats', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleStats);
app.get('/api/v1/governance/rules/:id', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRule);
app.delete('/api/v1/governance/rules/:id', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), deleteRule);
app.patch('/api/v1/governance/rules/:id', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), updateRule);
app.post('/api/v1/governance/rules/:id/submit-review', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), submitRuleForReview);
app.post('/api/v1/governance/rules/:id/publish', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), publishRule);
app.post('/api/v1/governance/rules/:id/deactivate', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), deactivateRule);
app.post('/api/v1/governance/rules/:id/reactivate', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), reactivateRule);
app.post('/api/v1/governance/rules/:id/archive', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), archiveRule);
app.post('/api/v1/governance/rules/:id/clone', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), cloneRule);
app.get('/api/v1/governance/rules/:id/scope', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleScope);
app.put('/api/v1/governance/rules/:id/scope', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), upsertRuleScope);
app.get('/api/v1/governance/rules/:id/path', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRulePath);
app.put('/api/v1/governance/rules/:id/path', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), upsertRulePath);
app.get('/api/v1/governance/rules/:id/versions', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleVersions);
app.get('/api/v1/governance/rules/:id/audit-log', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleAuditLog);
app.get('/api/v1/governance/rules/:id/conflicts', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleConflicts);
app.post('/api/v1/governance/rules/:id/conflicts/detect', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), detectRuleConflicts);
app.post('/api/v1/governance/rules/conflicts/:conflictId/resolve', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), resolveRuleConflict);
app.post('/api/v1/governance/rules/:id/simulate', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), runRuleSimulation);

// Additional Approval Rules endpoints
app.get('/api/v1/governance/rules/:id/details', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleDetails);
app.get('/api/v1/governance/rules/:id/stages', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleStagesHandler);
app.get('/api/v1/governance/rules/:id/escalations', authenticate, govRulesGuard, scopeGuard('read:governance', '*'), getRuleEscalationsHandler);
app.post('/api/v1/governance/rules/:id/mark-ready', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), markRuleReadyToPublish);
app.post('/api/v1/governance/rules/:id/mark-invalid', authenticate, govRulesGuard, scopeGuard('write:governance', '*'), markRuleInvalid);

// ─── Review Queue Routes (Accountability Layer) ──────────────────────
app.post('/api/v1/review-queue', authenticate, reviewQueueActionGuard, scopeGuard('write:governance', '*'), createReviewItem);
app.get('/api/v1/review-queue', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), listReviewItems);
app.get('/api/v1/review-queue/stats', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewStats);
app.get('/api/v1/review-queue/items/:id', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewItem);
app.post('/api/v1/review-queue/items/:id/action', authenticate, reviewQueueActionGuard, scopeGuard('write:publish', '*'), takeReviewAction);
app.get('/api/v1/review-queue/items/:id/eligibility', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewEligibility);
app.get('/api/v1/review-queue/items/:id/audit-log', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewAuditLog);
app.get('/api/v1/review-queue/items/:id/validation', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewValidation);
app.get('/api/v1/review-queue/items/:id/policy-flags', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewPolicyFlags);
app.get('/api/v1/review-queue/items/:id/notes', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewNotesHandler);
app.get('/api/v1/review-queue/items/:id/revision-history', authenticate, reviewQueueReadGuard, scopeGuard('read:governance', '*'), getReviewRevisionHistory);
app.patch('/api/v1/review-queue/items/:id/assign', authenticate, reviewQueueActionGuard, scopeGuard('write:governance', '*'), assignReviewItemHandler);
app.post('/api/v1/review-queue/items/:id/notes', authenticate, reviewQueueActionGuard, scopeGuard('write:governance', '*'), addReviewNoteHandler);
app.post('/api/v1/review-queue/bulk/:action', authenticate, reviewQueueActionGuard, scopeGuard('write:publish', '*'), bulkReviewAction);

// ─── Quality Audit Routes (Accountability Layer) ─────────────────────
app.get('/api/v1/quality-audit/items', authenticate, acctView, scopeGuard('read:governance', '*'), listAuditItems);
app.get('/api/v1/quality-audit/stats', authenticate, acctView, scopeGuard('read:governance', '*'), getQaAuditStats);
app.get('/api/v1/quality-audit/items/:id', authenticate, acctView, scopeGuard('read:governance', '*'), getAuditItem);
app.post('/api/v1/quality-audit/generate-sample', authenticate, acctWrite, scopeGuard('write:governance', '*'), generateSample);
app.post('/api/v1/quality-audit/items/:id/start', authenticate, acctWrite, scopeGuard('write:governance', '*'), startAudit);
app.post('/api/v1/quality-audit/items/:id/pass', authenticate, acctWrite, scopeGuard('write:governance', '*'), passAudit);
app.post('/api/v1/quality-audit/items/:id/fail', authenticate, acctWrite, scopeGuard('write:governance', '*'), failAudit);
app.post('/api/v1/quality-audit/items/:id/needs-correction', authenticate, acctWrite, scopeGuard('write:governance', '*'), needsCorrection);
app.post('/api/v1/quality-audit/items/:id/escalate', authenticate, acctWrite, scopeGuard('write:governance', '*'), escalateAudit);
app.post('/api/v1/quality-audit/items/:id/close', authenticate, acctWrite, scopeGuard('write:governance', '*'), closeAudit);
app.post('/api/v1/quality-audit/items/:id/assign', authenticate, acctWrite, scopeGuard('write:governance', '*'), assignAuditorToItem);
app.post('/api/v1/quality-audit/items/:id/scorecard', authenticate, acctWrite, scopeGuard('write:governance', '*'), saveScorecard);
app.post('/api/v1/quality-audit/items/:id/scorecard/override', authenticate, acctWrite, scopeGuard('write:governance', '*'), overrideScorecard);
app.post('/api/v1/quality-audit/items/:id/defects', authenticate, acctWrite, scopeGuard('write:governance', '*'), addDefect);
app.post('/api/v1/quality-audit/defects/:defectId/resolve', authenticate, acctWrite, scopeGuard('write:governance', '*'), resolveDefect);
app.post('/api/v1/quality-audit/items/:id/corrective-actions', authenticate, acctWrite, scopeGuard('write:governance', '*'), addCorrectiveAction);
app.patch('/api/v1/quality-audit/corrective-actions/:actionId', authenticate, acctWrite, scopeGuard('write:governance', '*'), updateCorrectiveAction);
app.post('/api/v1/quality-audit/items/:id/notes', authenticate, acctWrite, scopeGuard('write:governance', '*'), addQaNote);
app.post('/api/v1/quality-audit/items/:id/evidence', authenticate, acctWrite, scopeGuard('write:governance', '*'), addQaEvidence);
app.post('/api/v1/quality-audit/items/:id/retry-callback', authenticate, acctWrite, scopeGuard('write:governance', '*'), retryQaCallbackByItem);
app.get('/api/v1/quality-audit/items/:id/defects', authenticate, acctView, scopeGuard('read:governance', '*'), getAuditDefects);
app.get('/api/v1/quality-audit/items/:id/corrective-actions', authenticate, acctView, scopeGuard('read:governance', '*'), getAuditCorrectiveActions);
app.get('/api/v1/quality-audit/items/:id/notes', authenticate, acctView, scopeGuard('read:governance', '*'), getAuditNotes);
app.get('/api/v1/quality-audit/items/:id/evidence', authenticate, acctView, scopeGuard('read:governance', '*'), getAuditEvidence);
app.get('/api/v1/quality-audit/items/:id/eligibility', authenticate, acctView, scopeGuard('read:governance', '*'), getAuditEligibility);
app.get('/api/v1/quality-audit/items/:id/audit-log', authenticate, acctView, scopeGuard('read:governance', '*'), getQaAuditTrail);
app.post('/api/v1/quality-audit/callbacks/:callbackId/retry', authenticate, acctWrite, scopeGuard('write:governance', '*'), retryQaCallback);
app.post('/api/v1/quality-audit/export/findings', authenticate, acctView, scopeGuard('read:governance', '*'), exportQaFindings);
app.post('/api/v1/quality-audit/export/evidence', authenticate, acctView, scopeGuard('read:governance', '*'), exportQaEvidence);

// ─── Validation Desk Routes (Accountability Layer) ───────────────────
app.post('/api/v1/validation/items', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), createValidationItem);
app.get('/api/v1/validation/items', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), listValidationItems);
app.get('/api/v1/validation/stats', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationStats);
app.get('/api/v1/validation/items/:id', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationItem);
app.get('/api/v1/validation/items/:id/eligibility', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationEligibility);
app.get('/api/v1/validation/items/:id/audit-log', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationAuditTrail);
app.post('/api/v1/validation/items/:id/assign', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), assignValidator);
app.post('/api/v1/validation/items/:id/run', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), runValidation);
app.get('/api/v1/validation/runs/:runId/results', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationRunResults);
app.post('/api/v1/validation/items/:id/revalidate', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), revalidateItem);
app.post('/api/v1/validation/items/:id/request-revision', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), requestRevision);
app.post('/api/v1/validation/items/:id/return-to-creator', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), returnToCreator);
app.post('/api/v1/validation/items/:id/send-to-review-queue', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), sendToReviewQueue);
app.post('/api/v1/validation/items/:id/send-to-approvals', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), sendToApprovals);
app.post('/api/v1/validation/items/:id/escalate', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), escalateValidation);
app.post('/api/v1/validation/items/:id/override', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), applyOverride);
app.post('/api/v1/validation/items/:id/block', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), blockItem);
app.post('/api/v1/validation/items/:id/complete-manual-check', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), completeManualCheck);
app.post('/api/v1/validation/items/:id/notes', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), addValidatorNote);
app.get('/api/v1/validation/items/:id/notes', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationNotesList);
app.get('/api/v1/validation/items/:id/runs', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationRuns);
app.get('/api/v1/validation/items/:id/grounding', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationGrounding);
app.get('/api/v1/validation/items/:id/manual-check', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationManualChecks);
app.get('/api/v1/validation/items/:id/approval-readiness', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationApprovalReadiness);
app.get('/api/v1/validation/items/:id/rule-history', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), getValidationRuleHistory);
app.get('/api/v1/validation/items/:id/export', authenticate, validationDeskGuard, scopeGuard('read:governance', '*'), exportValidationRecord);
app.post('/api/v1/validation/callbacks/:callbackId/retry', authenticate, validationDeskGuard, scopeGuard('write:governance', '*'), retryValidationCallback);

// Support Routes
app.post('/api/v1/support/tickets', authenticate, SupportController.submitTicket);

// ─── Inbox & Engagement Routes ───────────────────────────────────────────────
import {
  listInboxMessages, getInboxMessage, createReply, generateAiDraft, sendReply,
  assignMessage, updateMessageStatus, escalateMessage, getEscalationQueue,
  resolveEscalation, addNote as addInboxNote, deleteInboxMessages, archiveMessage,
  getMessageAudit, syncPlatformMessages, getPostPreview,
} from './domains/inbox/inboxController';
import { verifyMetaWebhook, handleMetaWebhook } from './domains/inbox/inboxWebhook';
import {
  listAutoReplyRules, createAutoReplyRule, updateAutoReplyRule, deleteAutoReplyRule,
} from './domains/inbox/inboxSettingsController';

// Static routes before parameterized :id routes
app.get('/api/v1/inbox/settings/auto-reply',           authenticate, newInboxGuard, scopeGuard('read:content', '*'),  listAutoReplyRules);
app.post('/api/v1/inbox/settings/auto-reply',          authenticate, newInboxGuard, scopeGuard('write:content', '*'), createAutoReplyRule);
app.patch('/api/v1/inbox/settings/auto-reply/:id',     authenticate, newInboxGuard, scopeGuard('write:content', '*'), updateAutoReplyRule);
app.post('/api/v1/inbox/settings/auto-reply/:id/delete', authenticate, newInboxGuard, scopeGuard('write:content', '*'), deleteAutoReplyRule);
app.get('/api/v1/inbox/messages',                      authenticate, newInboxGuard, scopeGuard('read:content', '*'),  listInboxMessages);
app.post('/api/v1/inbox/messages/delete',              authenticate, newInboxGuard, scopeGuard('write:content', '*'), deleteInboxMessages);
app.get('/api/v1/inbox/escalations',                   authenticate, newInboxGuard, scopeGuard('read:content', '*'),  getEscalationQueue);
app.post('/api/v1/inbox/escalations/:escalationId/resolve', authenticate, newInboxGuard, scopeGuard('write:content', '*'), resolveEscalation);
app.post('/api/v1/inbox/sync',                         authenticate, newInboxGuard, scopeGuard('write:content', '*'), syncPlatformMessages);
app.get('/api/v1/inbox/messages/:id',                  authenticate, newInboxGuard, scopeGuard('read:content', '*'),  getInboxMessage);
app.post('/api/v1/inbox/messages/:id/reply',           authenticate, newInboxGuard, scopeGuard('write:content', '*'), createReply);
app.post('/api/v1/inbox/messages/:id/reply/generate',  authenticate, newInboxGuard, scopeGuard('write:content', '*'), generateAiDraft);
app.post('/api/v1/inbox/messages/:replyId/reply/send', authenticate, newInboxGuard, scopeGuard('write:content', '*'), sendReply);
app.post('/api/v1/inbox/messages/:id/assign',          authenticate, newInboxGuard, scopeGuard('write:content', '*'), assignMessage);
app.patch('/api/v1/inbox/messages/:id/status',         authenticate, newInboxGuard, scopeGuard('write:content', '*'), updateMessageStatus);
app.post('/api/v1/inbox/messages/:id/escalate',        authenticate, newInboxGuard, scopeGuard('write:content', '*'), escalateMessage);
app.post('/api/v1/inbox/messages/:id/archive',         authenticate, newInboxGuard, scopeGuard('write:content', '*'), archiveMessage);
app.post('/api/v1/inbox/messages/:id/notes',           authenticate, newInboxGuard, scopeGuard('write:content', '*'), addInboxNote);
app.get('/api/v1/inbox/messages/:id/audit',            authenticate, newInboxGuard, scopeGuard('read:content', '*'),  getMessageAudit);
app.get('/api/v1/inbox/messages/:id/post-preview',     authenticate, newInboxGuard, scopeGuard('read:content', '*'),  getPostPreview);
// Meta webhook endpoints (no auth — verified by hub.verify_token / X-Hub-Signature-256)
app.get('/api/v1/inbox/webhook/meta',  verifyMetaWebhook);
app.post('/api/v1/inbox/webhook/meta', express.raw({ type: 'application/json' }), handleMetaWebhook);



// Global Error Handler
app.use(errorHandler);

import { initWorker } from './workers/schedulerWorker';
import { initAuditExportWorker } from './workers/auditExportWorker';
import { initAuditIntegrityWorker } from './workers/auditIntegrityWorker';
import { initAuditStreamingWorker } from './workers/auditStreamingWorker';
import { initVaultWorker, initDlpScanWorker } from './workers/vaultWorker';
import { startCampaignWorker } from './workers/campaignWorker';
import { startCampaignLifecycleWorker } from './workers/campaignLifecycleWorker';
import { initOrgInactivityWorker } from './workers/orgInactivityWorker';
import { startSlaBreachWorker } from './workers/slaBreachWorker';
import { initEvidenceIntelligenceWorker } from './workers/evidenceIntelligenceWorker';
import { supabaseAdmin } from './shared/supabase';
import { AGENT_CATALOG } from './modules/prompts/validation/registry';
import { initRetentionWorker } from './workers/retentionWorker';
import { startTokenRefreshWorker } from './workers/tokenRefreshWorker';
// ─── Start Server ─────────────────────────────────────────────────────────────
try {
  registerExecutionListeners();
  registerEventBridge();
  // Phase 6.2 / 6.3 — wire real LLM providers into the ModelExecutionAdapter
  // registry. Missing keys ⇒ providers skipped (NullAdapter fallback).
  // PROMPT_GOVERNANCE_ENFORCED=true + zero keys ⇒ boot fails.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy require so env (provider keys) is loaded before adapter registration
  const { registerProductionAdapters } = require('./modules/prompts/modelProviders');
  registerProductionAdapters();
  const server = app.listen(port, () => {
    logger.info(`[server]: ZoikoVertex backend running in ${env.NODE_ENV} mode at http://localhost:${port}`);

    // Stripe config validation — warn early so missing keys surface at startup not at checkout
    if (env.STRIPE_SECRET_KEY) {
      if (!env.STRIPE_PRICE_GROWTH)  logger.warn('[Billing] STRIPE_PRICE_GROWTH not set — Growth plan subscriptions will fail');
      if (!env.STRIPE_PRICE_SCALE)   logger.warn('[Billing] STRIPE_PRICE_SCALE not set — Scale plan subscriptions will fail');
      if (!env.STRIPE_WEBHOOK_SECRET) logger.warn('[Billing] STRIPE_WEBHOOK_SECRET not set — webhooks will be unauthenticated in dev, rejected in production');
    }

    // Start background workers
    initWorker();
    initAuditExportWorker();
    initAuditIntegrityWorker();
    initAuditStreamingWorker();
    initVaultWorker();
    initDlpScanWorker();
    startCampaignWorker();
    startCampaignLifecycleWorker();
    initOrgInactivityWorker();
    startSlaBreachWorker();
    initEvidenceIntelligenceWorker();
    initRetentionWorker();
    startTokenRefreshWorker();

    // Ensure the media storage bucket exists with a 500 MB file-size limit.
    // Runs fire-and-forget on every boot so the limit is self-healing without
    // requiring a manual SQL migration in the Supabase dashboard.
    (async () => {
      try {
        const { error: updateErr } = await supabaseAdmin.storage.updateBucket('media', {
          public: true,
          fileSizeLimit: 524288000, // 500 MB
        });
        if (updateErr && updateErr.message?.toLowerCase().includes('not found')) {
          // Bucket doesn't exist yet — create it
          const { error: createErr } = await supabaseAdmin.storage.createBucket('media', {
            public: true,
            fileSizeLimit: 524288000,
          });
          if (createErr) logger.warn({ err: createErr.message }, '[startup] Could not create media storage bucket');
          else logger.info('[startup] media storage bucket created (500 MB limit)');
        } else if (updateErr) {
          logger.warn({ err: updateErr.message }, '[startup] Could not update media bucket file_size_limit');
        } else {
          logger.info('[startup] media storage bucket configured (500 MB limit)');
        }
      } catch (err) {
        logger.warn({ err }, '[startup] Storage bucket setup failed (non-fatal)');
      }
    })();

    // Governed validation agents must always be ACTIVE (Live).
    // If any were paused via the UI restore them automatically on every boot.
    const governedNames = AGENT_CATALOG.map((a) => a.name);
    supabaseAdmin
      .from('agents')
      .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
      .in('name', governedNames)
      .neq('status', 'ACTIVE')
      .then(({ error }) => {
        if (error) logger.warn({ err: error.message }, '[startup] Could not restore governed agents to ACTIVE');
        else logger.info('[startup] Governed validation agents verified ACTIVE');
      }, (err) => logger.warn({ err }, '[startup] Could not restore governed agents to ACTIVE'));
  });

  server.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[server] Error: Port ${port} is already in use.`);
    } else {
      logger.error({ err }, '[server] Error');
    }
    process.exit(1);
  });
} catch (startErr) {
  logger.error({ startErr }, '[server] Failed to start');
}
