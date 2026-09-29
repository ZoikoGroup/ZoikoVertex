const { sendMail } = require("../services/mailService");
const {
  getConversationOwner,
  getSessionHistory,
} = require("../services/chatService");
const { escapeHtml, formatChatHistory } = require("../utils/formatChatHistory");
const { getMailLimitStatus } = require("../middlewares/rateLimiter");
const {
  detectLanguageFromText,
  processSupportEmail,
  translateTranscriptMessages,
  getLangCode,
  translateReplyToUser,
} = require("../utils/translate");

function extractSupportMailSections(rawBody = "", fallbackSubject = "") {
  const cleanBody = typeof rawBody === "string" ? rawBody : "";
  const issueMatch = cleanBody.match(
    /Issue:\s*([\s\S]*?)\s*-{2,}\s*User Description:/i,
  );
  const descriptionMatch = cleanBody.match(
    /User Description:\s*([\s\S]*?)\s*-{2,}\s*Chat History:/i,
  );

  return {
    issue: (issueMatch?.[1] || fallbackSubject || "").trim(),
    description: (descriptionMatch?.[1] || cleanBody || "").trim(),
  };
}

function resolveOriginalLanguage({
  originalIssue = "",
  originalDescription = "",
  translatedMessages = [],
  translatedBody,
  translatedSubject,
}) {
  const detectedFromOriginalText = detectLanguageFromText(
    `${originalDescription} ${originalIssue}`.trim(),
  );

  if (detectedFromOriginalText && detectedFromOriginalText !== "Unknown") {
    return detectedFromOriginalText;
  }

  if (
    translatedBody?.sourceLang &&
    !["unknown", "english"].includes(translatedBody.sourceLang.toLowerCase())
  ) {
    return translatedBody.sourceLang;
  }

  if (
    translatedSubject?.sourceLang &&
    !["unknown", "english"].includes(translatedSubject.sourceLang.toLowerCase())
  ) {
    return translatedSubject.sourceLang;
  }

  const userLanguage = translatedMessages.find(
    (m) =>
      m.role === "user" &&
      m.detectedLanguage &&
      !["unknown", "english"].includes(m.detectedLanguage.toLowerCase()),
  )?.detectedLanguage;

  if (userLanguage) return userLanguage;

  return "English";
}

// Transcripts only ever go to the support mailbox. The recipient is never taken
// from the request, otherwise this endpoint becomes an open mail relay.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "info@zoikovertex.com";
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;

const sendMailHandler = async (req, res) => {
  try {
    const { sessionId, subject, body } = req.body;
    const user = {
      name: String(req.body.user?.name || "").slice(0, 120),
      company: String(req.body.user?.company || "").slice(0, 120),
      email: req.chatUser.email,
    };

    if (!sessionId || typeof subject !== "string" || !subject.trim()) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Missing required fields.",
      });
    }

    if (
      subject.length > MAX_SUBJECT_LENGTH ||
      (typeof body === "string" && body.length > MAX_BODY_LENGTH)
    ) {
      return res.status(400).json({
        success: false,
        code: "TOO_LONG",
        message: "Your message is too long. Please shorten it and try again.",
      });
    }

    const owner = await getConversationOwner(sessionId);
    if (!owner || owner.toLowerCase() !== user.email) {
      return res.status(403).json({
        success: false,
        code: "ACCESS_DENIED",
        message: "You do not have access to that conversation.",
      });
    }

    const messages = (await getSessionHistory(sessionId)).slice(-10);
    const extracted = extractSupportMailSections(body || "", subject);

    const [translatedSubject, translatedBody, translatedMessages] =
      await Promise.all([
        processSupportEmail(extracted.issue || subject),
        processSupportEmail(extracted.description || ""),
        translateTranscriptMessages(messages),
      ]);

    const originalLanguage = resolveOriginalLanguage({
      originalIssue: extracted.issue || subject,
      originalDescription: extracted.description || "",
      translatedMessages,
      translatedBody,
      translatedSubject,
    });

    const originalLangCode = getLangCode(originalLanguage);

    const html = formatChatHistory(
      translatedMessages,
      user,
      extracted.issue || subject,
      extracted.description || "",
      {
        originalLanguage,
        originalLangCode,
        translatedSubject:
          translatedSubject.englishBody || extracted.issue || subject,
        translatedDescription:
          translatedBody.englishBody || extracted.description || "",
        wasTranslated:
          translatedSubject.wasTranslated || translatedBody.wasTranslated,
      },
    );

    await sendMail({
      to: SUPPORT_EMAIL,
      replyTo: user.email,
      subject: translatedSubject.englishBody || subject,
      html,
      body: translatedBody.englishBody || body,
      meta: {
        originalLanguage,
        originalLangCode,
        userEmail: user.email,
        userName: user.name,
        sessionId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Email sent successfully.",
    });
  } catch (error) {
    console.error("[MailController] Error:", error.message);
    return res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Something went wrong. Please try again later.",
    });
  }
};

const replyToUserHandler = async (req, res) => {
  try {
    const { replyText, originalLangCode, userEmail, userName } = req.body;

    if (!replyText || !userEmail) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "replyText and userEmail are required.",
      });
    }

    const translated = await translateReplyToUser(replyText, originalLangCode);

    await sendMail({
      to: userEmail,
      subject: "Re: Your Support Request",
      body: translated.translated,
      html: `
        <div style="font-family:Arial;padding:20px;background:#f5f5f5;">
          <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <div style="background:#16a34a;color:#fff;padding:14px;font-weight:bold;">
              ZoikoVertex Support — Reply
            </div>
            <div style="padding:20px;">
              ${userName ? `<p>Hi ${escapeHtml(userName)},</p>` : ""}
              <p>${escapeHtml(translated.translated).replace(/\n/g, "<br/>")}</p>
              <hr/>
              <p style="font-size:12px;color:#888;">
                This reply was sent in: <b>${translated.lang || originalLangCode}</b>
              </p>
            </div>
          </div>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      translatedReply: translated.translated,
      sentInLanguage: translated.lang,
    });
  } catch (error) {
    console.error("[MailController] Reply error:", error.message);
    return res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Failed to send reply.",
    });
  }
};

const getMailStatusHandler = async (req, res) => {
  try {
    const status = await getMailLimitStatus(req.chatUser.email);
    return res.status(200).json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("[MailController] Status error:", error.message);
    return res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Unable to check mail status right now.",
    });
  }
};

module.exports = {
  sendMailHandler,
  replyToUserHandler,
  getMailStatusHandler,
};