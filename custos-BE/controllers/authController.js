const { supabase } = require("../config/db");
const { readBearerToken, signChatToken } = require("../middlewares/auth");
const User = require("../models/User");
const {
  createEmployeeId,
  findOrCreateConversationForUser,
} = require("../services/chatService");

async function verifyEmployee(req, res, next) {
  try {
    // The email must come from a verified ZoikoVertex (Supabase) session, never
    // from the request body — otherwise anyone could claim any identity.
    const accessToken = readBearerToken(req) || req.body.accessToken;
    if (!accessToken || !supabase) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Please sign in to ZoikoVertex to use the assistant.",
      });
    }

    const { data, error: authError } = await supabase.auth.getUser(accessToken);
    const verifiedEmail = data?.user?.email;
    if (authError || !verifiedEmail) {
      return res.status(401).json({
        success: false,
        code: "AUTH_INVALID",
        message: "Your ZoikoVertex session has expired. Please sign in again.",
      });
    }

    const normalizedEmail = verifiedEmail.toLowerCase().trim();
    const name = String(req.body.name || normalizedEmail.split("@")[0]).trim().slice(0, 120);
    const company = String(req.body.company || "ZoikoVertex").trim().slice(0, 120);
    const employeeId = createEmployeeId(company, normalizedEmail);

    let userPayload = {
      name,
      email: normalizedEmail,
      company,
      employeeId,
    };

    const activeConversation = await findOrCreateConversationForUser({
      name: userPayload.name,
      email: userPayload.email,
      company: userPayload.company,
      employeeId: userPayload.employeeId,
    });

    try {
      const user = await User.upsert({
        name: userPayload.name,
        email: userPayload.email,
        company: userPayload.company,
        employeeId: userPayload.employeeId,
        sessionId: activeConversation.sessionId,
      });

      userPayload = {
        name: user.name,
        email: user.email,
        company: user.company,
        employeeId: user.employee_id,
      };
    } catch (persistError) {
      console.error(
        "[AuthController] Failed to persist user:",
        persistError.message,
      );
    }

    const token = signChatToken({ email: userPayload.email });

    return res.json({
      success: true,
      sessionId: activeConversation.sessionId,
      expiresAt: activeConversation.expiresAt,
      token,
      user: {
        name: userPayload.name,
        email: userPayload.email,
        company: userPayload.company,
        employeeId: userPayload.employeeId,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { verifyEmployee };
