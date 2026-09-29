const { Router } = require("express");
const { verifyEmployee } = require("../controllers/authController");
const { createIpRateLimiter } = require("../middlewares/rateLimiter");

const router = Router();

// Identity is taken from the Supabase access token (Authorization: Bearer ...),
// so name/company in the body are display-only and not validated as identity.
router.post("/verify", createIpRateLimiter({ points: 20, duration: 60 }), verifyEmployee);

module.exports = router;
