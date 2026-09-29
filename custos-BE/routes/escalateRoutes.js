const { Router } = require("express");
const { escalateIssue, getEscalations, getEscalationById } = require("../controllers/escalateController");
const { requireAdmin } = require("../middlewares/auth");
const { createIpRateLimiter } = require("../middlewares/rateLimiter");

const router = Router();

router.post("/", createIpRateLimiter({ points: 5, duration: 600 }), escalateIssue);
router.get("/", requireAdmin, getEscalations);
router.get("/:id", requireAdmin, getEscalationById);

module.exports = router;
