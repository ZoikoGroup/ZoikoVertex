const fs = require("node:fs");
const path = require("node:path");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../config/db");
const NewPrompt = require("../models/NewPrompt");
const { normalizePrompt } = require("../utils/translate");

const {
  createHandoffTicket,
  getHandoffResponse,
} = require("./handoffService");
const { createGuardrails } = require("./guardrails");

// FIXED: Point to correct knowledge.json location (root, not /data)
const knowledgePath = path.resolve(__dirname, "..", "data", "knowledge.json");
let knowledgeDocument;
try {
  const rawData = fs.readFileSync(knowledgePath, "utf-8");
  knowledgeDocument = JSON.parse(rawData);
  console.log(
    `✅ Knowledge loaded: ${knowledgeDocument.intents?.length || 0} intents`,
  );
} catch (e) {
  console.error(`❌ Failed to load: ${knowledgePath}`, e.message);
  knowledgeDocument = {
    _meta: { assistantName: "Custos" },
    intents: [],
    fallback: "Knowledge base failed to load",
    default_suggestions: [],
    search_redirects: [],
  };
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const inMemoryHistory = new Map();
const inMemoryConversations = new Map();

// ── Conversation state machine for handoff flow ──
const CONVERSATION_STATES = {
  NORMAL: "normal",
  HANDOFF_OFFERED: "handoff_offered",
};

const handoffState = new Map(); // sessionId -> { state, collectedInfo }

const AFFIRMATIVE_PATTERNS = [
  /^(yes|yeah|yep|yup|sure|ok|okay|alright|fine|go ahead|please do|do it|connect me|route me|send me|id like that|id love that)/i,
  /^(yes|yeah|sure|ok|okay),?\s*(please|connect|route|help|send)/i,
  /\b(yes|sure|okay|ok)\b.*\b(human|agent|support|connect|route|help)/i,
];

const NEGATIVE_PATTERNS = [
  /^(no|nah|nope|not now|never mind|cancel|forget it|skip|no thanks)/i,
  /^(no|nah),?\s*(thanks|thank you|i'm good|ill figure|not needed)/i,
];

function isAffirmative(message) {
  const text = message.trim().toLowerCase();
  return AFFIRMATIVE_PATTERNS.some((p) => p.test(text));
}

function isNegative(message) {
  const text = message.trim().toLowerCase();
  return NEGATIVE_PATTERNS.some((p) => p.test(text));
}

function getHandoffState(sessionId) {
  const entry = handoffState.get(sessionId);
  if (!entry) return { state: CONVERSATION_STATES.NORMAL, collectedInfo: {} };
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
    handoffState.delete(sessionId);
    return { state: CONVERSATION_STATES.NORMAL, collectedInfo: {} };
  }
  return entry;
}

function setHandoffState(sessionId, state, collectedInfo = {}) {
  handoffState.set(sessionId, { state, collectedInfo, createdAt: Date.now() });
}

function clearHandoffState(sessionId) {
  handoffState.delete(sessionId);
}
function normalizeText(value = "") {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text = "") {
  return normalizeText(text).split(" ").filter(Boolean);
}

async function trackUnknownPrompt(message) {
  if (!message || !message.trim() || !supabase) return null;

  try {
    const normalized = await normalizePrompt(message);
    const prompt = normalizeText(normalized.normalizedText);
    if (!prompt) return null;

    return await NewPrompt.incrementOrCreate(prompt);
  } catch (error) {
    console.error(
      "[ChatService] Failed to track unknown prompt:",
      error.message,
    );
    return null;
  }
}

function personalizeText(text = "") {
  return text;
}

function slugify(value = "") {
  return normalizeText(value).replace(/\s+/g, "-") || uuidv4();
}

function createExpiryDate(base = Date.now()) {
  return new Date(base + SESSION_TTL_MS).toISOString();
}

function summarizeText(text = "", maxLength = 110) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}…`;
}

function extractQuestion(intent = {}) {
  if (intent.question) return intent.question;
  if (intent.title) return intent.title;
  if (intent.label) return intent.label;
  if (Array.isArray(intent.keywords) && intent.keywords.length > 0) {
    return intent.keywords[0];
  }
  if (Array.isArray(intent.trigger_signals) && intent.trigger_signals.length > 0) {
    return intent.trigger_signals[0];
  }
  return "General help";
}

const intents = Array.isArray(knowledgeDocument.intents)
  ? knowledgeDocument.intents
      .filter((intent) => intent && (intent.response || intent.answer_first))
      .map((intent) => ({
        id: intent.id || slugify(extractQuestion(intent)),
        question: extractQuestion(intent),
        answer: personalizeText(intent.answer_first || intent.response),
        keywords: Array.isArray(intent.keywords)
          ? intent.keywords
          : Array.isArray(intent.trigger_signals)
            ? intent.trigger_signals
            : [],
        category: intent.category || "general",
      }))
  : [];

const defaultSuggestions = Array.isArray(knowledgeDocument.default_suggestions)
  ? knowledgeDocument.default_suggestions
  : intents.slice(0, 6).map((intent) => intent.label || intent.question);


// ─── Surface knowledge indexes ───────────────────────────────────────────────
// PUBLIC_WEB may only use entries listed in data/publicKnowledge.json
// (default-deny). Anything not allowlisted is technically ineligible for
// retrieval on the public website (ZV-WEBCHAT-REQ-001 WEB-INT-004).
let publicKnowledge = { intents: [], faq: [] };
try {
  publicKnowledge = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "data", "publicKnowledge.json"), "utf-8"),
  );
} catch (e) {
  console.error("❌ Failed to load publicKnowledge.json — public mode has no knowledge:", e.message);
}

function buildKnowledgeIndex({ intentIds, faqQuestions } = {}) {
  const allowIntent = (id) => !intentIds || intentIds.has(id);
  const scopedIntents = intents.filter((intent) => allowIntent(intent.id));
  const scopedRawIntents = (knowledgeDocument.intents || []).filter((intent) =>
    allowIntent(intent.id || slugify(extractQuestion(intent))),
  );
  const scopedFaq = (knowledgeDocument.faq || []).filter(
    (entry) => !faqQuestions || faqQuestions.has(entry.q),
  );
  const scopedSuggestions = defaultSuggestions.filter((label) =>
    scopedIntents.some((intent) => intent.question === label),
  );

  const triggerPhrases = new Set();
  for (const intent of scopedRawIntents) {
    for (const phrase of [...(intent.trigger_signals || []), ...(intent.keywords || []), intent.label]) {
      const normalized = normalizeText(String(phrase || ""));
      if (normalized.length >= 2) triggerPhrases.add(normalized);
    }
  }

  return {
    intents: scopedIntents,
    rawIntents: scopedRawIntents,
    triggerPhrases: [...triggerPhrases],
    faq: scopedFaq,
    defaultSuggestions:
      scopedSuggestions.length > 0
        ? scopedSuggestions
        : scopedIntents.slice(0, 6).map((intent) => intent.question),
  };
}

const knowledgeIndexes = {
  platform: buildKnowledgeIndex(),
  public: buildKnowledgeIndex({
    intentIds: new Set(publicKnowledge.intents || []),
    faqQuestions: new Set(publicKnowledge.faq || []),
  }),
};

const guardrails = createGuardrails(knowledgeDocument);

const quickActions = Array.isArray(knowledgeDocument.search_redirects)
  ? knowledgeDocument.search_redirects.slice(0, 6).map((item) => ({
      id: item.id,
      label: item.actionLabel || item.prompt || item.intentId || "Open",
      prompt: item.prompt || item.actionLabel || "Open section",
      message: item.prompt || item.actionLabel || item.intentId || "Help",
    }))
  : [];

const greetingIntent =
  intents.find((intent) =>
    intent.keywords.some((keyword) =>
      ["hi", "hello", "hey", "help", "start"].includes(normalizeText(keyword)),
    ),
  ) ||
  intents[0] ||
  null;

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "about", "up",
  "what", "who", "which", "whom", "whose", "this", "that", "these",
  "those", "it", "its", "we", "you", "your", "yours", "our", "ours",
  "they", "them", "their", "theirs", "me", "my", "mine", "he", "she",
  "his", "her", "hers", "i", "am", "if", "or", "but", "any", "also",
  "well", "now", "get", "like", "want", "need", "can't", "wont", "dont",
  "won't", "don't", "cant", "doesnt", "doesn't", "isnt", "isn't",
]);

const ZOIKOVERTEX_TERMS = new Set([
  "zoikovertex", "vertex", "custos", "zoiko", "governed", "agentic",
  "execution", "three", "key", "approval", "protocol", "evidence",
  "vault", "authority", "layer", "doctrine", "pricing", "plan",
  "starter", "growth", "scale", "corporate", "demo", "publish",
  "publishing", "hub", "campaign", "workflow", "brand", "library",
  "security", "privacy", "dpa", "gdpr", "compliance", "audit",
  "trail", "forensic", "ledger", "legal", "hold", "crisis",
  "console", "sso", "saml", "scim", "api", "webhook", "connector",
  "integration", "channel", "role", "taxonomy", "admin", "workspace",
  "billing", "subscription", "invoice", "refund", "marketing",
  "social", "media", "agent", "studio", "prompt", "governance",
  "restriction", "content", "validation", "desk", "review", "queue",
  "career", "job", "press", "about", "leadership", "vision",
  "mission", "competitor", "hootsuite", "sprout", "benchmark",
  "alternative", "migrate", "migration", "onboard", "training",
  "support", "ticket", "escalate", "human", "handoff",
  "url", "urls", "link", "links", "website",
]);

function scoreEntry(message, entry) {
  const messageText = normalizeText(message);
  const messageTokens = new Set(tokenize(message));
  let score = 0;

  if (messageText.includes(normalizeText(entry.question))) score += 10;

  for (const keyword of entry.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) continue;

    if (messageText.includes(normalizedKeyword)) {
      score += 5;
      continue;
    }

    const kwTokens = tokenize(keyword);
    const significantTokens = kwTokens.filter((t) => !STOP_WORDS.has(t));
    if (significantTokens.length === 0) continue;

    const matchedTokens = significantTokens.filter((t) => messageTokens.has(t));
    const ratio = matchedTokens.length / significantTokens.length;
    if (ratio >= 0.5) score += ratio * 3.5;

    for (const token of matchedTokens) {
      score += 0.85;
    }
  }

  for (const token of tokenize(entry.question)) {
    if (messageTokens.has(token) && !STOP_WORDS.has(token)) score += 0.85;
  }

  return score;
}

function buildFallbackAnswer(language = "en", kb = knowledgeIndexes.platform) {
  const fallbackSource =
    knowledgeDocument.fallback ||
    knowledgeDocument.templates?.fallback ||
    "I want to make sure I help you correctly. Could you clarify what you need?";
  return {
    id: uuidv4(),
    answer: personalizeText(fallbackSource),
    matchedQuestion: "Fallback response",
    confidence: 0.24,
    suggestions: kb.defaultSuggestions.slice(0, 3),
    route: null,
    intent: "fallback",
    timestamp: new Date().toISOString(),
  };
}

function buildWelcomeMessage(_language = "en") {
  if (knowledgeDocument.templates?.greeting) {
    return personalizeText(knowledgeDocument.templates.greeting);
  }
  if (greetingIntent?.answer) return greetingIntent.answer;
  return personalizeText(
    knowledgeDocument.templates?.fallback ||
    knowledgeDocument.fallback ||
    "How can I help you today?",
  );
}

function localizeAnswer(entry, language) {
  if (language !== "hi") return entry.answer;
  return entry.answer;
}

function createSessionId() {
  return uuidv4();
}

function createEmployeeId(company, email) {
  const companyCode = (company || "zoiko")
    .replace(/\s+/g, "")
    .slice(0, 4)
    .toUpperCase();
  const userCode = (email || "user").split("@")[0].slice(0, 4).toUpperCase();
  return `${companyCode}-${userCode}-${Date.now().toString().slice(-4)}`;
}

function createConversationSnapshot({
  sessionId,
  user,
  title = "New conversation",
}) {
  return {
    sessionId,
    userEmail: user?.email || "unknown@local",
    userName: user?.name || "",
    company: user?.company || "",
    employeeId: user?.employeeId || "",
    title,
    preview: "",
    messageCount: 0,
    status: "active",
    startedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    expiresAt: createExpiryDate(),
  };
}

function getInMemoryConversation(sessionId) {
  const conversation = inMemoryConversations.get(sessionId);
  if (!conversation) return null;
  if (new Date(conversation.expiresAt).getTime() <= Date.now()) {
    inMemoryConversations.delete(sessionId);
    inMemoryHistory.delete(sessionId);
    return null;
  }
  return conversation;
}

async function upsertConversation({ sessionId, user, title, preview, status }) {
  const expiresAt = createExpiryDate();
  const now = new Date().toISOString();

  const payload = {
    sessionId,
    userEmail: user?.email || "unknown@local",
    userName: user?.name || "",
    company: user?.company || "",
    employeeId: user?.employeeId || "",
    lastMessageAt: now,
    expiresAt,
  };
  if (title) payload.title = summarizeText(title, 70);
  if (preview !== undefined) payload.preview = summarizeText(preview, 150);
  if (status) payload.status = status;

  const current =
    getInMemoryConversation(sessionId) ||
    createConversationSnapshot({ sessionId, user });

  const nextConversation = {
    ...current,
    ...payload,
    messageCount: current.messageCount || 0,
  };
  inMemoryConversations.set(sessionId, nextConversation);

  try {
    if (!supabase) return nextConversation;

    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("session_id", sessionId)
      .single();

    if (existing) {
      await supabase
        .from("conversations")
        .update({
          session_id: sessionId,
          user_email: payload.userEmail,
          user_name: payload.userName,
          company: payload.company,
          employee_id: payload.employeeId,
          last_message_at: payload.lastMessageAt,
          expires_at: payload.expiresAt,
          status: payload.status || existing.status || current.status,
          title: payload.title || existing.title || current.title,
          preview:
            payload.preview !== undefined
              ? payload.preview
              : existing.preview || current.preview,
        })
        .eq("session_id", sessionId);
    } else {
      await supabase.from("conversations").insert({
        session_id: sessionId,
        user_email: payload.userEmail,
        user_name: payload.userName,
        company: payload.company,
        employee_id: payload.employeeId,
        title: payload.title || current.title || "New conversation",
        preview: payload.preview ?? current.preview ?? "",
        message_count: current.messageCount || 0,
        started_at: current.startedAt || now,
        last_message_at: payload.lastMessageAt,
        expires_at: payload.expiresAt,
        status: status || "active",
      });
    }
  } catch (_error) {}

  return nextConversation;
}

async function incrementConversationMessageCount(
  sessionId,
  user,
  content,
  role,
) {
  const current =
    getInMemoryConversation(sessionId) ||
    createConversationSnapshot({ sessionId, user });

  const nextCount = (current.messageCount || 0) + 1;
  const nextTitle =
    current.title && current.title !== "New conversation"
      ? current.title
      : role === "user"
        ? summarizeText(content, 70)
        : current.title;

  const now = new Date().toISOString();
  const nextConversation = {
    ...current,
    title: nextTitle || "New conversation",
    preview: summarizeText(content, 150),
    messageCount: nextCount,
    lastMessageAt: now,
    expiresAt: createExpiryDate(),
  };
  inMemoryConversations.set(sessionId, nextConversation);

  try {
    if (!supabase) return;

    const { data: existing } = await supabase
      .from("conversations")
      .select("message_count")
      .eq("session_id", sessionId)
      .single();

    if (existing) {
      await supabase
        .from("conversations")
        .update({
          user_email: user?.email || "unknown@local",
          user_name: user?.name || "",
          company: user?.company || "",
          employee_id: user?.employeeId || "",
          title: nextConversation.title,
          preview: nextConversation.preview,
          message_count: (existing.message_count || 0) + 1,
          last_message_at: nextConversation.lastMessageAt,
          expires_at: nextConversation.expiresAt,
        })
        .eq("session_id", sessionId);
    } else {
      await supabase.from("conversations").insert({
        session_id: sessionId,
        user_email: user?.email || "unknown@local",
        user_name: user?.name || "",
        company: user?.company || "",
        employee_id: user?.employeeId || "",
        title: nextConversation.title,
        preview: nextConversation.preview,
        message_count: 1,
        status: "active",
        started_at: current.startedAt || now,
        last_message_at: nextConversation.lastMessageAt,
        expires_at: nextConversation.expiresAt,
      });
    }
  } catch (_error) {}
}

async function createConversationForUser(user) {
  const sessionId = createSessionId();
  const conversation = await upsertConversation({
    sessionId,
    user,
    title: "New conversation",
    preview: "",
    status: "active",
  });
  return { sessionId, expiresAt: conversation.expiresAt };
}

async function findOrCreateConversationForUser(user) {
  const now = new Date().toISOString();
  try {
    if (!supabase) throw new Error("Supabase not configured");

    const { data: existing } = await supabase
      .from("conversations")
      .select("session_id, expires_at")
      .eq("user_email", user?.email || "unknown@local")
      .gt("expires_at", now)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .single();

    if (existing)
      return { sessionId: existing.session_id, expiresAt: existing.expires_at };
  } catch (_error) {}

  const memoryConversation = [...inMemoryConversations.values()]
    .filter(
      (conversation) =>
        conversation.userEmail === (user?.email || "unknown@local") &&
        new Date(conversation.expiresAt).getTime() > Date.now(),
    )
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))[0];

  if (memoryConversation)
    return {
      sessionId: memoryConversation.sessionId,
      expiresAt: memoryConversation.expiresAt,
    };

  return createConversationForUser(user);
}

async function endConversation(sessionId, userEmail) {
  clearHandoffState(sessionId);
  const conversation = getInMemoryConversation(sessionId);
  if (conversation && (!userEmail || conversation.userEmail === userEmail)) {
    conversation.status = "ended";
    conversation.lastMessageAt = new Date().toISOString();
    inMemoryConversations.set(sessionId, conversation);
  }
  try {
    if (!supabase) return;

    let query = supabase
      .from("conversations")
      .update({
        status: "ended",
        last_message_at: new Date().toISOString(),
        expires_at: createExpiryDate(),
      })
      .eq("session_id", sessionId);

    if (userEmail) query = query.eq("user_email", userEmail);

    await query;
  } catch (_error) {}
}

async function deleteConversation(sessionId, userEmail) {
  inMemoryConversations.delete(sessionId);
  inMemoryHistory.delete(sessionId);
  try {
    let convQuery = supabase
      .from("conversations")
      .delete()
      .eq("session_id", sessionId);
    if (userEmail) convQuery = convQuery.eq("user_email", userEmail);
    await convQuery;

    let chatQuery = supabase.from("chats").delete().eq("session_id", sessionId);
    if (userEmail) chatQuery = chatQuery.eq("user_email", userEmail);
    await chatQuery;
  } catch (_error) {}
}

// Returns the owning email for a session, or null if the session is unknown.
async function getConversationOwner(sessionId) {
  if (!sessionId) return null;

  const memoryConversation = getInMemoryConversation(sessionId);
  if (memoryConversation?.userEmail) return memoryConversation.userEmail;

  try {
    if (!supabase) return null;

    const { data } = await supabase
      .from("conversations")
      .select("user_email")
      .eq("session_id", sessionId)
      .maybeSingle();

    return data?.user_email || null;
  } catch (_error) {
    return null;
  }
}

async function listUserConversations(userEmail) {
  const now = Date.now();
  const memoryConversations = [...inMemoryConversations.values()]
    .filter(
      (conversation) =>
        conversation.userEmail === userEmail &&
        new Date(conversation.expiresAt).getTime() > now,
    )
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .map((conversation) => ({
      sessionId: conversation.sessionId,
      title: conversation.title,
      preview: conversation.preview,
      messageCount: conversation.messageCount,
      status: conversation.status,
      startedAt: conversation.startedAt,
      lastMessageAt: conversation.lastMessageAt,
      expiresAt: conversation.expiresAt,
    }));

  try {
    if (!supabase) throw new Error("Supabase not configured");

    const { data: conversations } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_email", userEmail)
      .gt("expires_at", new Date().toISOString())
      .order("last_message_at", { ascending: false });

    if (conversations && conversations.length) {
      return conversations.map((conversation) => ({
        sessionId: conversation.session_id,
        title: conversation.title,
        preview: conversation.preview,
        messageCount: conversation.message_count,
        status: conversation.status,
        startedAt: conversation.started_at,
        lastMessageAt: conversation.last_message_at,
        expiresAt: conversation.expires_at,
      }));
    }
  } catch (_error) {}

  return memoryConversations;
}

function generateChatReply(message, language = "en", kb = knowledgeIndexes.platform) {
  const normalizedMessage = normalizeText(message);

  // 1. Greeting / salutation detection (before scoring loop)
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy)(\s|$)/.test(normalizedMessage) ||
      /^(hi|hello|hey)\s+(there|everyone|all|team)/.test(normalizedMessage)) {
    const greetingText = knowledgeDocument.templates?.greeting
      ?? knowledgeDocument._meta?.greeting
      ?? "Hello — I'm Custos, the ZoikoVertex assistant. I can help you understand the platform, find trust documents, or reach the right team.";
    return {
      id: uuidv4(),
      answer: personalizeText(greetingText),
      matchedQuestion: "Greeting",
      confidence: 0.99,
      suggestions: kb.defaultSuggestions.slice(0, 6),
      route: null,
      intent: "greeting",
      timestamp: new Date().toISOString(),
    };
  }

  // 1.5 Main menu / restart command
  if (/^(back to main menu|back to menu|go to main menu|return to main menu|main menu|menu|start over|restart|reset conversation)(\s|$)/.test(normalizedMessage)) {
    const menuText =
      knowledgeDocument.templates?.greeting
      ?? knowledgeDocument._meta?.greeting
      ?? "Hello — I'm Custos, the ZoikoVertex assistant. I can help you understand the platform, find trust documents, or reach the right team. Here are some things I can help with:";
    return {
      id: uuidv4(),
      answer: personalizeText(menuText),
      matchedQuestion: "Main menu",
      confidence: 0.99,
      suggestions: kb.defaultSuggestions.slice(0, 6),
      route: null,
      intent: "menu",
      timestamp: new Date().toISOString(),
    };
  }

  // 1.6 Capabilities overview
  if (/^(what can custos help with|what can custos do|what can you help with|what can you do|what do you help with|capabilities)(\s|\?|$)/.test(normalizedMessage)) {
    return {
      id: uuidv4(),
      answer: personalizeText(
        "Here's what I can help you with:\n\n• Pricing, plans, and comparing ZoikoVertex tiers\n• Governance — the Three-Key Approval Protocol, the Authority Layer Doctrine, and Governed Agentic Execution\n• Trust records — Evidence Vault, Audit Trail, Forensic Hub, Identity Ledger\n• Security, privacy, DPA, and compliance\n• Platform features — Agent Studio, Prompt Governance, Brand Library, Crisis Console, integrations, and more\n\nWhich would you like to explore?",
      ),
      matchedQuestion: "Capabilities overview",
      confidence: 0.99,
      suggestions: kb.defaultSuggestions.slice(0, 6),
      route: null,
      intent: "capabilities",
      timestamp: new Date().toISOString(),
    };
  }

  // 1.7 Human handoff request
  if (/(connect me to a human|connect me with a human|transfer me to (a|the) human|talk to a human|speak to a human|talk to a person|speak to a person|help me reach a human|human support)/.test(normalizedMessage)) {
    return {
      id: uuidv4(),
      answer: "Thank you! Please use the mail option to share your details, and our team will get back to you shortly.\n\nThanks for the conversation. If you have more questions about ZoikoVertex, I'm here.",
      matchedQuestion: "Human handoff request",
      confidence: 0.99,
      suggestions: [],
      route: null,
      intent: "handoff",
      timestamp: new Date().toISOString(),
    };
  }

  // 1.8 Rephrase follow-up
  if (/(rephrase|word it differently|phrase it differently|ask differently|say it differently|say that differently)/.test(normalizedMessage)) {
    return {
      id: uuidv4(),
      answer: "Sure — please rephrase your question and I'll try again.",
      matchedQuestion: "Rephrase request",
      confidence: 0.99,
      suggestions: kb.defaultSuggestions.slice(0, 6),
      route: null,
      intent: "rephrase",
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Goodbye / thanks
  if (/^(bye|goodbye|see you|thanks|thank you|cheers|ok|okay|yes)(\s|$)/.test(normalizedMessage)) {
    const goodbyeText = knowledgeDocument.templates?.goodbye
      ?? "Thanks for the conversation. If you have more questions about ZoikoVertex, I'm here.";
    return {
      id: uuidv4(),
      answer: personalizeText(goodbyeText),
      matchedQuestion: "Goodbye",
      confidence: 0.99,
      suggestions: kb.defaultSuggestions.slice(0, 6),
      route: null,
      intent: "goodbye",
      timestamp: new Date().toISOString(),
    };
  }

  // 3. Email manager trigger
  const emailManagerPrompt = knowledgeDocument.email_manager_prompt;
  if (
    emailManagerPrompt &&
    Array.isArray(emailManagerPrompt.trigger_keywords) &&
    emailManagerPrompt.trigger_keywords.some((keyword) =>
      normalizedMessage.includes(normalizeText(keyword)),
    )
  ) {
    return {
      id: uuidv4(),
      answer: personalizeText(emailManagerPrompt.response),
      matchedQuestion: "Email manager",
      confidence: 0.98,
      suggestions: kb.defaultSuggestions.slice(0, 3),
      route: null,
      intent: "email_manager",
      timestamp: new Date().toISOString(),
    };
  }

  // 4. Full-question match against FAQ titles
  const faqMatch = findFaqMatch(message, kb.faq);
  if (faqMatch) {
    return {
      id: uuidv4(),
      answer: personalizeText(faqMatch.a),
      matchedQuestion: faqMatch.q,
      confidence: 0.9,
      suggestions: kb.defaultSuggestions.slice(0, 6),
      route: null,
      intent: "faq",
      timestamp: new Date().toISOString(),
    };
  }

  // 5. Score-based intent matching
  const ranked = kb.intents
    .map((entry) => ({ ...entry, score: scoreEntry(message, entry) }))
    .sort((a, b) => b.score - a.score);
  const bestMatch = ranked[0];

  if (!bestMatch || bestMatch.score < 1.5) return buildFallbackAnswer(language, kb);

  const confidence = Math.min(0.99, Number((bestMatch.score / 16).toFixed(2)));

  const originalIntent = kb.rawIntents.find(
    (intent) =>
      (intent.id || slugify(extractQuestion(intent))) === bestMatch.id,
  );

  return {
    id: uuidv4(),
    answer: localizeAnswer(bestMatch, language),
    matchedQuestion: bestMatch.question,
    confidence,
    suggestions: Array.isArray(originalIntent?.suggestions)
      ? originalIntent.suggestions
      : ranked.slice(1, 4).map((entry) => entry.question),
    route: originalIntent?.route ?? null,
    intent: bestMatch.id,
    timestamp: new Date().toISOString(),
  };
}

function getWebsiteUrls() {
  try {
    const urlsPath = path.resolve(__dirname, "..", "data", "websiteUrls.json");
    return JSON.parse(fs.readFileSync(urlsPath, "utf-8"));
  } catch {
    return { pages: [], redirects: [] };
  }
}

function matchWebsiteUrl(message) {
  const urls = getWebsiteUrls();
  const text = normalizeText(message);
  const tokens = new Set(tokenize(message));

  function keywordMatches(keyword) {
    const nkw = normalizeText(keyword);
    if (nkw.length <= 2) {
      return tokens.has(nkw);
    }
    return text.includes(nkw);
  }

  const matchedPage = urls.pages.find((page) =>
    page.keywords.some((kw) => keywordMatches(kw))
  );
  if (matchedPage) {
    return {
      path: matchedPage.path,
      label: matchedPage.label,
      url: `${urls._meta.baseUrl}${matchedPage.path}`,
    };
  }

  const matchedRedirect = urls.redirects.find((r) =>
    r.from.some((alias) => keywordMatches(alias))
  );
  if (matchedRedirect) {
    return {
      path: matchedRedirect.to,
      label: matchedRedirect.label,
      url: `${urls._meta.baseUrl}${matchedRedirect.to}`,
    };
  }

  return null;
}

// Product-specific terms. A single generic word ("social", "media", "job",
// "link") is not enough to treat a message as being about ZoikoVertex.
const STRONG_ZOIKOVERTEX_TERMS = new Set([
  "zoikovertex", "vertex", "custos", "zoiko", "governed", "agentic",
  "evidence", "vault", "doctrine", "pricing", "price", "prices", "plan",
  "plans", "tier", "tiers", "starter", "demo", "publishing", "campaign",
  "campaigns", "workflow", "workflows", "brand", "governance", "compliance",
  "audit", "forensic", "ledger", "dpa", "gdpr", "ccpa", "sso", "saml",
  "scim", "api", "webhook", "webhooks", "connector", "connectors",
  "integration", "integrations", "security", "privacy", "subscription",
  "billing", "trial", "onboarding", "agent", "agents", "studio", "prompt",
  "approval", "approvals", "protocol", "validation", "hootsuite", "sprout",
  "competitor", "competitors", "benchmark", "careers", "press",
  "subprocessor", "subprocessors", "retention", "responsible",
]);

// True when the message contains a whole approved trigger phrase, e.g. "$399"
// or "data processing addendum".
function hasKnownTriggerPhrase(message, kb = knowledgeIndexes.platform) {
  const padded = ` ${normalizeText(message)} `;
  return kb.triggerPhrases.some((phrase) => padded.includes(` ${phrase} `));
}

function hasStrongZoikoVertexTerm(message) {
  return tokenize(normalizeText(message)).some((t) => STRONG_ZOIKOVERTEX_TERMS.has(t));
}

function hasZoikoVertexTopic(message) {
  const text = normalizeText(message);
  const tokens = tokenize(text);
  return tokens.some((t) => ZOIKOVERTEX_TERMS.has(t));
}

function findFaqMatch(message, faq = knowledgeDocument.faq ?? []) {
  const msgTokens = new Set(tokenize(message));
  return faq.find((entry) => {
    if (!entry.q) return false;
    const faqTokens = tokenize(entry.q).filter((t) => !STOP_WORDS.has(t));
    if (faqTokens.length < 2) return false;
    const matched = faqTokens.filter((t) => msgTokens.has(t));
    const distFaQTokens = faqTokens.filter((t) => t !== "zoikovertex" && t !== "support");
    if (distFaQTokens.length === 0) return matched.length >= faqTokens.length;
    const distMatched = distFaQTokens.filter((t) => msgTokens.has(t));
    return distMatched.length >= Math.max(1, distFaQTokens.length * 0.6) && matched.length >= 2;
  });
}

function isMatchReliable(message, ruleReply, kb = knowledgeIndexes.platform) {
  if (ruleReply.intent === "fallback") return false;
  if (["greeting", "goodbye", "menu", "capabilities", "email_manager", "handoff", "rephrase"].includes(ruleReply.intent)) return true;

  const text = normalizeText(message);

  if (ruleReply.intent === "faq") {
    return findFaqMatch(message, kb.faq) !== undefined;
  }

  const intent = kb.rawIntents.find(
    (i) => (i.id || slugify(extractQuestion(i))) === ruleReply.intent,
  );
  if (!intent) {
    return false;
  }

  const signals = [
    ...(intent.trigger_signals || []),
    ...(intent.keywords || []),
    normalizeText(intent.label || ""),
    normalizeText(intent.question || ""),
  ].filter(Boolean);

  const distinctSignals = [...new Set(signals.map((s) => s.toLowerCase().trim()))];

  let strongMatchCount = 0;
  for (const signal of distinctSignals) {
    const words = tokenize(signal);
    const sigWords = words.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    if (sigWords.length === 0 && words.length > 0) {
      if (text.includes(normalizeText(signal))) {
        strongMatchCount += 0.5;
      }
      continue;
    }

    if (text.includes(normalizeText(signal))) {
      strongMatchCount++;
    } else {
      const matchedWords = sigWords.filter((w) => text.includes(w));
      if (matchedWords.length >= Math.max(2, sigWords.length * 0.66)) {
        strongMatchCount += 0.5;
      }
    }
  }

  return (
    strongMatchCount >= 1 ||
    hasStrongZoikoVertexTerm(message) ||
    hasKnownTriggerPhrase(message, kb)
  );
}

const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || "https://zoikovertex.com").replace(/\/$/, "");
const PLATFORM_LOGIN_URL = process.env.PLATFORM_LOGIN_URL || "https://getzoikovertex.com/login";

const PUBLIC_HANDOFF_ANSWER =
  `You can reach the right ZoikoVertex team directly:\n\n` +
  `• Sales, pricing, and demos: ${PUBLIC_SITE_URL}/contact-sales\n` +
  `• Existing customer support: ${PUBLIC_SITE_URL}/support\n` +
  `• Email: info@zoikovertex.com`;

const PUBLIC_ACCOUNT_ANSWER =
  `I can't see or change account details from the public website. ` +
  `Please log in to ZoikoVertex (${PLATFORM_LOGIN_URL}) to manage your workspace, ` +
  `or contact Support (${PUBLIC_SITE_URL}/support) for help with your account.`;

function buildRuleResponse({ intent, answer, suggestions = [], route = null }) {
  return {
    id: uuidv4(),
    answer,
    matchedQuestion: intent,
    confidence: 0.99,
    suggestions,
    route,
    intent,
    timestamp: new Date().toISOString(),
    source: "rule",
  };
}

// surface: "platform" (authenticated dashboard) or "public" (PUBLIC_WEB).
async function generateHybridReply(message, language = "en", history, sessionId, user, { surface = "platform" } = {}) {
  const isPublic = surface === "public";
  const kb = isPublic ? knowledgeIndexes.public : knowledgeIndexes.platform;
  const scopeSuggestions = ["What can Custos help with?", "Back to main menu"];

  // 1. Guardrails always run first — a keyword match can never override them.
  const guardrailHit = guardrails.checkGuardrails(message);
  if (guardrailHit) {
    if (sessionId) clearHandoffState(sessionId);
    return buildRuleResponse({
      intent: `guardrail_${guardrailHit.id}`,
      answer: guardrailHit.answer,
      suggestions: scopeSuggestions,
    });
  }

  // 2. Public visitors never get account-specific help from assumed context.
  if (isPublic && guardrails.isAccountSpecificRequest(message)) {
    if (sessionId) clearHandoffState(sessionId);
    return buildRuleResponse({
      intent: "account_specific",
      answer: PUBLIC_ACCOUNT_ANSWER,
      suggestions: ["What can Custos help with?"],
    });
  }

  // 3. Clearly unrelated requests (recipes, sports, code, medical, ...).
  if (guardrails.isOutOfScopeRequest(message) && !hasStrongZoikoVertexTerm(message)) {
    if (sessionId) clearHandoffState(sessionId);
    return buildRuleResponse({
      intent: "out_of_scope",
      answer: guardrails.outOfScopeAnswer,
      suggestions: scopeSuggestions,
    });
  }

  if (sessionId) {
    const hs = getHandoffState(sessionId);

    if (hs.state === CONVERSATION_STATES.HANDOFF_OFFERED) {
      if (isAffirmative(message)) {
        clearHandoffState(sessionId);
        return buildRuleResponse({
          intent: "handoff",
          answer: isPublic
            ? PUBLIC_HANDOFF_ANSWER
            : "Thank you! Please use the mail option to share your details, and our team will get back to you shortly.\n\nThanks for the conversation. If you have more questions about ZoikoVertex, I'm here.",
        });
      }
      if (isNegative(message)) {
        clearHandoffState(sessionId);
      }
    }
  }

  const ruleReply = generateChatReply(message, language, kb);

  // The platform handoff copy refers to the in-app mail form, which the public
  // website does not have.
  if (isPublic && ruleReply.intent === "handoff") {
    if (sessionId) clearHandoffState(sessionId);
    return { ...ruleReply, answer: PUBLIC_HANDOFF_ANSWER, source: "rule" };
  }

  if (ruleReply.intent !== "fallback" && (isMatchReliable(message, ruleReply, kb) || ruleReply.intent === "website_url" || ruleReply.intent === "contact_us")) {
    if (sessionId) clearHandoffState(sessionId);
    return {
      ...ruleReply,
      source: "rule",
    };
  }

  const urlMatch = matchWebsiteUrl(message);
  if (urlMatch && !ruleReply.route) {
    if (sessionId) clearHandoffState(sessionId);
    return {
      ...ruleReply,
      route: urlMatch.path,
      suggestions: [
        ...(ruleReply.suggestions || []),
        `Open ${urlMatch.label}`,
      ],
      source: "rule",
    };
  }

  // 4. Nothing ZoikoVertex-related at all — decline instead of guessing.
  if (!hasZoikoVertexTopic(message) && !hasKnownTriggerPhrase(message, kb)) {
    if (sessionId) clearHandoffState(sessionId);
    return buildRuleResponse({
      intent: "out_of_scope",
      answer: guardrails.outOfScopeAnswer,
      suggestions: kb.defaultSuggestions.slice(0, 3),
    });
  }

  // 5. ZoikoVertex-related but no approved answer.
  if (isPublic) {
    if (sessionId) clearHandoffState(sessionId);
    return {
      ...buildFallbackAnswer(language, kb),
      answer: `I don't have an approved public answer for that yet.\n\n${PUBLIC_HANDOFF_ANSWER}`,
      source: "rule",
    };
  }

  if (sessionId) setHandoffState(sessionId, CONVERSATION_STATES.HANDOFF_OFFERED, {});
  const handoffMsg = "Would you like me to connect you with someone who can help?";
  return {
    ...ruleReply,
    answer: ruleReply.intent === "fallback"
      ? `${ruleReply.answer}\n\n${handoffMsg}`
      : `I'm not sure I understood that correctly.\n\n${handoffMsg}`,
    suggestions: [
      ...(ruleReply.suggestions || []),
      "Yes, connect me to a human",
      "I'll rephrase my question",
    ],
    source: "rule",
  };
}

async function handleHumanHandoff({ user, message, sessionId }) {
  const ticket = createHandoffTicket({ user, message, sessionId });
  const response = getHandoffResponse(ticket);

  return {
    id: uuidv4(),
    answer: response.answer,
    matchedQuestion: "Human handoff request",
    confidence: 0.99,
    suggestions: response.suggestions,
    route: null,
    intent: "handoff",
    timestamp: new Date().toISOString(),
    source: "handoff",
    handoffId: response.handoffId,
    handoffCategory: response.category,
  };
}

async function getUnknownPrompts() {
  if (!supabase) return [];

  try {
    return await NewPrompt.listAll();
  } catch (error) {
    console.error(
      "[ChatService] Failed to load unknown prompts:",
      error.message,
    );
    return [];
  }
}

function getChatContext() {
  const assistantName = personalizeText(
    knowledgeDocument._meta?.assistantName || "Custos",
  );
  return {
    assistantName,
    productName: knowledgeDocument._meta?.product || "ZoikoVertex",
    assistantBadge: "GOVERNED AGENTIC ASSISTANT",
    statusText: "Custos knowledge base active",
    welcomeMessage: buildWelcomeMessage("en"),
    welcomeMessageHi: buildWelcomeMessage("en"),
    quickActions:
      quickActions.length > 0
        ? quickActions
        : defaultSuggestions.slice(0, 6).map((item) => ({
            id: slugify(item),
            label: item,
            prompt: item,
            message: item,
          })),
    defaultSuggestions: defaultSuggestions.slice(0, 6),
    retentionHours: 24,
  };
}

async function saveMessage({
  sessionId,
  user,
  userEmail,
  role,
  content,
  metadata = {},
}) {
  const expiresAt = createExpiryDate();
  const message = {
    id: uuidv4(),
    role,
    content,
    metadata,
    timestamp: new Date().toISOString(),
  };

  const existing = inMemoryHistory.get(sessionId) || [];
  inMemoryHistory.set(sessionId, [...existing, message]);

  await incrementConversationMessageCount(
    sessionId,
    user || { email: userEmail },
    content,
    role,
  );

  try {
    if (!supabase) return message;

    await supabase.from("chats").insert({
      session_id: sessionId,
      user_email: userEmail,
      role,
      content,
      metadata,
      expires_at: expiresAt,
    });
  } catch (_error) {}

  return message;
}

async function getSessionHistory(sessionId) {
  const fallbackMessages = inMemoryHistory.get(sessionId) || [];
  try {
    if (!supabase) throw new Error("Supabase not configured");

    const { data: dbMessages } = await supabase
      .from("chats")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (!dbMessages || !dbMessages.length) return fallbackMessages;

    return dbMessages.map((entry) => ({
      id: entry.id.toString(),
      role: entry.role,
      content: entry.content,
      meta: entry.metadata,
      timestamp: entry.created_at,
    }));
  } catch (_error) {
    return fallbackMessages.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      meta: entry.metadata,
      timestamp: entry.timestamp,
    }));
  }
}

module.exports = {
  createConversationForUser,
  createEmployeeId,
  createSessionId,
  deleteConversation,
  endConversation,
  findOrCreateConversationForUser,
  generateChatReply,
  generateHybridReply,

  getConversationOwner,
  handleHumanHandoff,
  matchWebsiteUrl,
  getChatContext,
  getUnknownPrompts,
  getSessionHistory,
  listUserConversations,
  saveMessage,
  trackUnknownPrompt,
};
