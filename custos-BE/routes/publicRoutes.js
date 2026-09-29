const { Router } = require("express");
const {
  createVisitorSession,
  getPublicContext,
  sendPublicMessage,
} = require("../controllers/publicChatController");
const { requirePublicVisitor } = require("../middlewares/auth");
const {
  createIpRateLimiter,
  createVisitorRateLimiter,
} = require("../middlewares/rateLimiter");

// PUBLIC_WEB surface for zoikovertex.com. Anonymous and tenantless — see
// controllers/publicChatController.js. No platform route is reachable with a
// visitor token, and no visitor route accepts a platform token.
const router = Router();

router.get("/context", getPublicContext);
router.post("/session", createIpRateLimiter({ points: 10, duration: 60 }), createVisitorSession);
router.post(
  "/chat",
  createIpRateLimiter({ points: 20, duration: 60 }),
  requirePublicVisitor,
  createVisitorRateLimiter({ points: 30, duration: 300 }),
  sendPublicMessage,
);

module.exports = router;
