const { Router } = require("express");
const {
  closeSession,
  createSession,
  getChatHistory,
  getChatUiContext,
  getTrackedPrompts,
  getUserSessions,
  removeSession,
  requestHumanHandoff,
  sendChatMessage,
} = require("../controllers/chatController");
const { requireAdmin, requireChatUser } = require("../middlewares/auth");
const {
  chatRateLimiter,
  createIpRateLimiter,
} = require("../middlewares/rateLimiter");

const router = Router();
const handoffRateLimiter = createIpRateLimiter({ points: 5, duration: 600 });

router.post("/", chatRateLimiter, requireChatUser, sendChatMessage);

router.get("/context", getChatUiContext);
router.get("/sessions", requireChatUser, getUserSessions);
router.get("/new-prompts", requireAdmin, getTrackedPrompts);
router.post("/sessions", requireChatUser, createSession);
router.patch("/sessions/:sessionId/end", requireChatUser, closeSession);
router.delete("/sessions/:sessionId", requireChatUser, removeSession);
router.get("/history/:sessionId", requireChatUser, getChatHistory);
router.post("/handoff", handoffRateLimiter, requireChatUser, requestHumanHandoff);

module.exports = router;
