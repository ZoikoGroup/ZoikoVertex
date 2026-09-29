const express = require("express");
const router = express.Router();
const {
  sendMailHandler,
  getMailStatusHandler,
} = require("../controllers/mailController");
const { requireChatUser } = require("../middlewares/auth");
const { mailRateLimiter } = require("../middlewares/rateLimiter");

router.get("/status", requireChatUser, getMailStatusHandler);
router.post("/send", requireChatUser, mailRateLimiter, sendMailHandler);

module.exports = router;
