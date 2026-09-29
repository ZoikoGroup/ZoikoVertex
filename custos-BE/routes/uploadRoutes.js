const { Router } = require("express");
const { uploadFile, upload } = require("../controllers/uploadController");
const { requireChatUser } = require("../middlewares/auth");
const { createIpRateLimiter } = require("../middlewares/rateLimiter");

const router = Router();

router.post(
  "/",
  createIpRateLimiter({ points: 10, duration: 600 }),
  requireChatUser,
  upload.single("file"),
  uploadFile,
);

module.exports = router;
