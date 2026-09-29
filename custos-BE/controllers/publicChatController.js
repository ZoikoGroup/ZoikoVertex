// ─── Public website chat (PUBLIC_WEB mode) ───────────────────────────────────
// ZV-WEBCHAT-REQ-001: the public website reuses the existing Custos engine
// through this controlled surface. Every request here is:
//   • anonymous and tenantless (visitor token only — no email, workspace, role)
//   • forced to surface "public" server-side, whatever the client sends
//   • answered only from data/publicKnowledge.json, after the shared guardrails
//   • never persisted to the platform conversation tables, and its text is
//     never written to logs or the unknown-prompt tracker
const knowledgeDocument = require("../data/knowledge.json");
const { signVisitorToken, PUBLIC_MODE } = require("../middlewares/auth");
const { generateHybridReply } = require("../services/chatService");

const MAX_MESSAGE_LENGTH = 1000;
const MAX_SUGGESTIONS = 4;
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || "https://zoikovertex.com").replace(/\/$/, "");
const PRIVACY_URL = `${PUBLIC_SITE_URL}/privacy`;
const PLATFORM_LOGIN_URL = process.env.PLATFORM_LOGIN_URL || "https://getzoikovertex.com/login";

const pageLabels = new Map(
  (knowledgeDocument.page_registry || []).map((page) => [page.path, page.label]),
);

const PUBLIC_QUICK_ACTIONS = [
  "What is ZoikoVertex?",
  "Compare plans",
  "Book a demo",
  "How does the Three-Key Approval Protocol work?",
  "Security and privacy",
  "Talk to Sales",
];

function buildLinks(route) {
  if (!route || typeof route !== "string" || route === "/") return [];
  if (!/^\/[\w\-/]*$/.test(route)) return [];
  return [{ label: pageLabels.get(route) || "Learn more", url: `${PUBLIC_SITE_URL}${route}` }];
}

// Page context is advisory only (WEB-UX-002): it is validated and logged as a
// path, and never influences knowledge scope, policy, or authority.
function readPagePath(pageContext) {
  const pagePath = pageContext?.path;
  return typeof pagePath === "string" && pagePath.length <= 200 && /^\/[\w\-/]*$/.test(pagePath)
    ? pagePath
    : null;
}

function logPublicEvent(fields) {
  // Structured, content-free log line so public traffic is distinguishable from
  // platform traffic (section 8 observability). Never includes message text.
  console.log(JSON.stringify({ event: "custos_public_chat", mode: PUBLIC_MODE, ...fields }));
}

function createVisitorSession(_req, res) {
  const { token, expiresIn } = signVisitorToken();
  return res.json({ success: true, token, expiresIn, mode: PUBLIC_MODE });
}

function getPublicContext(_req, res) {
  return res.json({
    success: true,
    context: {
      assistantName: "Custos",
      productName: "ZoikoVertex",
      welcomeMessage:
        "Hi, I'm Custos, the ZoikoVertex assistant. I can explain the platform, compare plans, point you to security and privacy information, or connect you with Sales or Support.",
      quickActions: PUBLIC_QUICK_ACTIONS,
      privacyNotice:
        "Custos is an automated assistant that answers from approved ZoikoVertex public information. Please don't share passwords, payment details, or other sensitive information.",
      privacyUrl: PRIVACY_URL,
      contactSalesUrl: `${PUBLIC_SITE_URL}/contact-sales`,
      supportUrl: `${PUBLIC_SITE_URL}/support`,
      loginUrl: PLATFORM_LOGIN_URL,
      maxMessageLength: MAX_MESSAGE_LENGTH,
    },
  });
}

async function sendPublicMessage(req, res) {
  const startedAt = Date.now();
  const { message, pageContext } = req.body || {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ success: false, message: "Please type a question." });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Please keep your question under ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  try {
    const reply = await generateHybridReply(
      message.trim(),
      "en",
      [],
      `public:${req.visitor.visitorId}`,
      null,
      { surface: "public" },
    );

    logPublicEvent({
      intent: reply.intent,
      outcome: /^(guardrail_|out_of_scope|account_specific)/.test(reply.intent)
        ? "declined"
        : reply.intent === "fallback"
          ? "unresolved"
          : "answered",
      page: readPagePath(pageContext),
      latencyMs: Date.now() - startedAt,
    });

    // Return only what the widget needs — no confidence scores, matched
    // questions, or other engine internals.
    return res.json({
      success: true,
      message: {
        answer: reply.answer,
        suggestions: (reply.suggestions || []).slice(0, MAX_SUGGESTIONS),
        links: buildLinks(reply.route),
        intent: reply.intent,
      },
    });
  } catch (error) {
    logPublicEvent({ intent: "error", outcome: "error", latencyMs: Date.now() - startedAt });
    console.error("[PublicChat] Reply failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Custos is unavailable right now. You can still reach us at info@zoikovertex.com.",
    });
  }
}

module.exports = { createVisitorSession, getPublicContext, sendPublicMessage };
