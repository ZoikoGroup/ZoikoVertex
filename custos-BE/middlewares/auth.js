const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

// ─── JWT secret ──────────────────────────────────────────────────────────────
// Never fall back to a guessable constant. If JWT_SECRET is missing we use a
// per-process random secret, so tokens simply stop working after a restart.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(48).toString("hex");
  console.warn(
    "⚠️  JWT_SECRET is not set — using a random per-process secret. Chat tokens will be invalidated on restart.",
  );
}

const TOKEN_TTL = "7d";
const VISITOR_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const PUBLIC_MODE = "PUBLIC_WEB";
const PUBLIC_AUDIENCE = "custos-public";

function signChatToken({ email }) {
  return jwt.sign({ email }, jwtSecret, { expiresIn: TOKEN_TTL });
}

// Anonymous, tenantless visitor token for the public website. It carries no
// email, workspace, role or tenant — only a random visitor id.
function signVisitorToken() {
  const visitorId = crypto.randomUUID();
  const token = jwt.sign({ mode: PUBLIC_MODE, vid: visitorId }, jwtSecret, {
    expiresIn: VISITOR_TOKEN_TTL_SECONDS,
    audience: PUBLIC_AUDIENCE,
  });
  return { token, visitorId, expiresIn: VISITOR_TOKEN_TTL_SECONDS };
}

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token.trim() : null;
}

function normalizeEmail(email = "") {
  return String(email).toLowerCase().trim();
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

// ─── requireChatUser ─────────────────────────────────────────────────────────
// Identity comes only from the signed Custos token issued by /api/auth/verify,
// never from the request body or query string.
function requireChatUser(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "Please sign in to use the assistant.",
    });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    // Public visitor tokens must never grant platform access.
    if (payload.mode || payload.aud) throw new Error("Not a platform token");
    const email = normalizeEmail(payload.email);
    if (!email) throw new Error("Token has no email");
    req.chatUser = { email };
    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      code: "AUTH_INVALID",
      message: "Your assistant session has expired. Please sign in again.",
    });
  }
}

// ─── requirePublicVisitor ────────────────────────────────────────────────────
function requirePublicVisitor(req, res, next) {
  const token = readBearerToken(req);
  try {
    if (!token) throw new Error("Missing token");
    const payload = jwt.verify(token, jwtSecret, { audience: PUBLIC_AUDIENCE });
    if (payload.mode !== PUBLIC_MODE || !payload.vid || payload.email) {
      throw new Error("Not a public visitor token");
    }
    req.visitor = { visitorId: payload.vid, mode: PUBLIC_MODE };
    return next();
  } catch (_error) {
    return res.status(401).json({
      success: false,
      code: "VISITOR_SESSION_INVALID",
      message: "Your chat session has expired. Please start a new chat.",
    });
  }
}

// ─── requireAdmin ────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  requireChatUser(req, res, () => {
    if (!getAdminEmails().includes(req.chatUser.email)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "You do not have access to this resource.",
      });
    }
    return next();
  });
}

module.exports = {
  normalizeEmail,
  readBearerToken,
  PUBLIC_MODE,
  requireAdmin,
  requireChatUser,
  requirePublicVisitor,
  signChatToken,
  signVisitorToken,
};
