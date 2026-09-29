const { validationResult } = require("express-validator");
const {
  createConversationForUser,
  deleteConversation,
  endConversation,
  generateHybridReply,
  getConversationOwner,
  handleHumanHandoff,
  getChatContext,
  getUnknownPrompts,
  getSessionHistory,
  listUserConversations,
  saveMessage,
  trackUnknownPrompt,
} = require("../services/chatService");

const MAX_MESSAGE_LENGTH = 2000;
const ACCESS_DENIED_MESSAGE = "You do not have access to that conversation.";

// The verified email from the Custos token always wins; name/company from the
// body are display-only.
function resolveUser(req) {
  const bodyUser = req.body?.user || {};
  return {
    name: String(bodyUser.name || "").slice(0, 120),
    company: String(bodyUser.company || "").slice(0, 120),
    email: req.chatUser.email,
  };
}

// "ok" = caller owns it, "missing" = unknown session, "forbidden" = someone else's.
async function checkSessionAccess(sessionId, email) {
  const owner = await getConversationOwner(sessionId);
  if (!owner) return "missing";
  return owner.toLowerCase() === email ? "ok" : "forbidden";
}

function denyAccess(res) {
  return res.status(403).json({
    success: false,
    code: "ACCESS_DENIED",
    message: ACCESS_DENIED_MESSAGE,
  });
}

// 🔥 MAIN CHAT FUNCTION
async function sendChatMessage(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
      });
    }

    let { sessionId, message, language = "en", fileUrl, fileName, fileType } = req.body;
    const user = resolveUser(req);

    if (typeof message === "string" && message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message is too long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
      });
    }

    if (fileUrl && !/^\/uploads\/[\w.-]+$/.test(String(fileUrl))) {
      return res.status(400).json({ success: false, message: "Invalid file reference." });
    }

    // ✅ prevent empty messages (allow file-only messages)
    if ((!message || !message.trim()) && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: "Message or file is required",
      });
    }

    // ✅ fallback language
    if (!["en", "hi"].includes(language)) {
      console.log("⚠️ Invalid language:", language);
      language = "en";
    }

    if (sessionId) {
      const access = await checkSessionAccess(sessionId, user.email);
      if (access === "forbidden") return denyAccess(res);
      // Unknown/expired session ids are never reused — start a fresh one.
      if (access === "missing") sessionId = null;
    }

    // 🔥 CREATE SESSION ONLY WHEN FIRST MESSAGE COMES
    if (!sessionId) {
      const session = await createConversationForUser(user);
      sessionId = session.sessionId;
      console.log("🆕 Created new session:", sessionId);
    }

    // ✅ SAVE USER MESSAGE
    const metadata = {};
    if (fileUrl) {
      metadata.file = { url: fileUrl, name: fileName || "file", type: fileType || "application/octet-stream" };
    }
    await saveMessage({
      sessionId,
      user,
      userEmail: user.email,
      role: "user",
      content: (message || "").trim(),
      metadata,
    });

    // ✅ GENERATE BOT REPLY (hybrid: rule-first, AI fallback)
    let reply;
    try {
      const history = await getSessionHistory(sessionId);
      reply = await generateHybridReply(message, language, history, sessionId, user);
    } catch (err) {
      console.error("❌ Reply generation failed:", err);
      reply = {
        answer: "Sorry, something went wrong.",
        suggestions: [],
        route: null,
        intent: "error",
      };
    }

    if (reply.intent === "fallback" && reply.source !== "ai") {
      await trackUnknownPrompt(message);
    }

    // ✅ SAVE ASSISTANT MESSAGE
    const assistantMeta = {
      matchedQuestion: reply.matchedQuestion,
      confidence: reply.confidence,
      suggestions: reply.suggestions,
      route: reply.route,
      intent: reply.intent,
      source: reply.source || "rule",
    };

    if (reply.citations) {
      assistantMeta.citations = reply.citations;
    }

    if (reply.model) {
      assistantMeta.model = reply.model;
    }

    if (reply.handoffId) {
      assistantMeta.handoffId = reply.handoffId;
      assistantMeta.handoffCategory = reply.handoffCategory;
    }

    await saveMessage({
      sessionId,
      user,
      userEmail: user.email,
      role: "assistant",
      content: reply.answer,
      metadata: assistantMeta,
    });

    // ✅ RETURN RESPONSE
    return res.json({
      success: true,
      sessionId,
      message: reply,
    });
  } catch (error) {
    console.error("❌ ERROR in sendChatMessage:", error);
    next(error);
  }
}

async function getTrackedPrompts(_req, res, next) {
  try {
    const prompts = await getUnknownPrompts();
    return res.json({
      success: true,
      prompts,
    });
  } catch (error) {
    next(error);
  }
}

// 🔹 GET CHAT HISTORY
async function getChatHistory(req, res, next) {
  try {
    const access = await checkSessionAccess(req.params.sessionId, req.chatUser.email);
    if (access === "forbidden") return denyAccess(res);

    const messages =
      access === "ok" ? await getSessionHistory(req.params.sessionId) : [];
    const context = getChatContext();

    return res.json({
      success: true,
      messages:
        messages.length > 0
          ? messages
          : [
              {
                id: "welcome",
                role: "assistant",
                content: context.welcomeMessage,
                timestamp: new Date().toISOString(),
              },
            ],
    });
  } catch (error) {
    next(error);
  }
}

// 🔹 GET UI CONTEXT
function getChatUiContext(_req, res, next) {
  try {
    return res.json({
      success: true,
      context: getChatContext(),
    });
  } catch (error) {
    next(error);
  }
}

// 🔹 GET USER SESSIONS
async function getUserSessions(req, res, next) {
  try {
    const sessions = await listUserConversations(req.chatUser.email);
    return res.json({ success: true, sessions });
  } catch (error) {
    next(error);
  }
}

// 🔹 CREATE SESSION (optional endpoint)
async function createSession(req, res, next) {
  try {
    const session = await createConversationForUser(resolveUser(req));
    return res.json({
      success: true,
      session,
    });
  } catch (error) {
    next(error);
  }
}

// 🔹 END SESSION
async function closeSession(req, res, next) {
  try {
    const access = await checkSessionAccess(req.params.sessionId, req.chatUser.email);
    if (access === "forbidden") return denyAccess(res);
    if (access === "ok") {
      await endConversation(req.params.sessionId, req.chatUser.email);
    }
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

// 🔹 DELETE SESSION
async function removeSession(req, res, next) {
  try {
    const access = await checkSessionAccess(req.params.sessionId, req.chatUser.email);
    if (access === "forbidden") return denyAccess(res);
    if (access === "ok") {
      await deleteConversation(req.params.sessionId, req.chatUser.email);
    }
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function requestHumanHandoff(req, res, next) {
  try {
    let { sessionId, message } = req.body;
    const user = resolveUser(req);

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message is required for handoff.",
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message is too long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
      });
    }

    if (sessionId) {
      const access = await checkSessionAccess(sessionId, user.email);
      if (access === "forbidden") return denyAccess(res);
      if (access === "missing") sessionId = null;
    }

    const reply = await handleHumanHandoff({ user, message, sessionId });

    // Only persist into a conversation the caller owns — never a shared bucket.
    if (!sessionId) {
      return res.json({ success: true, sessionId: null, message: reply });
    }

    await saveMessage({
      sessionId,
      user,
      userEmail: user.email,
      role: "assistant",
      content: reply.answer,
      metadata: {
        intent: "handoff",
        handoffId: reply.handoffId,
        handoffCategory: reply.handoffCategory,
        source: "handoff",
      },
    });

    return res.json({
      success: true,
      sessionId,
      message: reply,
    });
  } catch (error) {
    console.error("❌ ERROR in requestHumanHandoff:", error);
    next(error);
  }
}

module.exports = {
  closeSession,
  createSession,
  getChatUiContext,
  getTrackedPrompts,
  requestHumanHandoff,
  sendChatMessage,
  getChatHistory,
  getUserSessions,
  removeSession,
};
