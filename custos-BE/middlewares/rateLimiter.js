const { RateLimiterMemory } = require("rate-limiter-flexible");
const { supabase } = require("../config/db");

// ─── Per-IP limiters ─────────────────────────────────────────────────────────
// req.ip is the real client address only because server.js sets "trust proxy".
function createIpRateLimiter({ points, duration }) {
  const limiter = new RateLimiterMemory({ points, duration });

  return async function ipRateLimiter(req, res, next) {
    try {
      await limiter.consume(req.ip || "local");
      next();
    } catch (_error) {
      res.status(429).json({
        success: false,
        message: "Too many requests. Please wait a moment and try again.",
      });
    }
  };
}

// Per public visitor token, on top of the per-IP limit.
function createVisitorRateLimiter({ points, duration }) {
  const limiter = new RateLimiterMemory({ points, duration });

  return async function visitorRateLimiter(req, res, next) {
    try {
      await limiter.consume(req.visitor?.visitorId || req.ip || "local");
      next();
    } catch (_error) {
      res.status(429).json({
        success: false,
        message: "You're sending messages quickly. Please wait a moment and try again.",
      });
    }
  };
}

// Chat: 20 requests per 60 seconds per IP
const chatRateLimiter = createIpRateLimiter({ points: 20, duration: 60 });

// ─── Email Rate Limiter using Supabase (persists across server restarts) ──────
const EMAIL_LIMIT = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getMailLimitStatus(key) {
  if (!key || !supabase) {
    return {
      allowed: true,
      remaining: EMAIL_LIMIT,
      limit: EMAIL_LIMIT,
      msBeforeNextReset: 0,
    };
  }

  const now = new Date();
  const { data: record, error } = await supabase
    .from("email_rate_limits")
    .select("*")
    .eq("key", key)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!record) {
    return {
      allowed: true,
      remaining: EMAIL_LIMIT,
      limit: EMAIL_LIMIT,
      msBeforeNextReset: 0,
    };
  }

  const expireTime = new Date(record.expire);
  if (now >= expireTime) {
    return {
      allowed: true,
      remaining: EMAIL_LIMIT,
      limit: EMAIL_LIMIT,
      msBeforeNextReset: 0,
    };
  }

  const remaining = Math.max(0, EMAIL_LIMIT - (record.points || 0));
  return {
    allowed: remaining > 0,
    remaining,
    limit: EMAIL_LIMIT,
    msBeforeNextReset: Math.max(0, expireTime.getTime() - now.getTime()),
  };
}

async function mailRateLimiter(req, res, next) {
  // Keyed on the verified token identity — the body's user.email is untrusted.
  const key = req.chatUser?.email || req.ip || "local";

  try {
    const now = new Date();
    const { data: record } = await supabase
      .from("email_rate_limits")
      .select("*")
      .eq("key", key)
      .single();

    if (record) {
      const expireTime = new Date(record.expire);

      if (now < expireTime) {
        // Window still active — check points
        if (record.points >= EMAIL_LIMIT) {
          // Limit reached — return ms remaining
          const msBeforeNextReset = expireTime.getTime() - now.getTime();
          return res.status(429).json({
            success: false,
            code: "EMAIL_LIMIT_REACHED",
            msBeforeNextReset,
          });
        }

        // Still has points — increment
        await supabase
          .from("email_rate_limits")
          .update({ points: record.points + 1 })
          .eq("key", key);
      } else {
        // Window expired — reset
        await supabase
          .from("email_rate_limits")
          .update({
            points: 1,
            expire: new Date(now.getTime() + WINDOW_MS).toISOString(),
          })
          .eq("key", key);
      }
    } else {
      // First time — create record
      await supabase.from("email_rate_limits").insert({
        key,
        points: 1,
        expire: new Date(now.getTime() + WINDOW_MS).toISOString(),
      });
    }

    next();
  } catch (_error) {
    // If Supabase fails, allow the request through
    next();
  }
}

module.exports = {
  chatRateLimiter,
  createIpRateLimiter,
  createVisitorRateLimiter,
  mailRateLimiter,
  getMailLimitStatus,
};
