const { v4: uuidv4 } = require("uuid");
const { sendMail } = require("./mailService");
const { escapeHtml } = require("../utils/formatChatHistory");

const handoffRequests = [];

const HANDOFF_CATEGORIES = {
  SALES: { label: "Sales Enquiry", route: "sales" },
  LEGAL: { label: "Legal / DPA", route: "legal" },
  SECURITY: { label: "Security Review", route: "security" },
  BILLING: { label: "Billing Support", route: "billing" },
  SUPPORT: { label: "Technical Support", route: "support" },
};

function categorizeHandoff(message, userState = "public") {
  const text = (message || "").toLowerCase();

  if (/(enterprise|command tier|custom pricing|contract|procurement|vendor|60k|acv)/.test(text))
    return HANDOFF_CATEGORIES.SALES;
  if (/(dpa|legal|contract review|attorney|lawyer|regulatory)/.test(text))
    return HANDOFF_CATEGORIES.LEGAL;
  if (/(security questionnaire|pentest|soc|iso|vendor assessment)/.test(text))
    return HANDOFF_CATEGORIES.SECURITY;
  if (/(billing|refund|invoice|cancel subscription|payment|charge|receipt)/.test(text))
    return HANDOFF_CATEGORIES.BILLING;
  if (/(bug|error|not working|cant log in|broken|issue|problem|technical)/.test(text))
    return HANDOFF_CATEGORIES.SUPPORT;

  return HANDOFF_CATEGORIES.SUPPORT;
}

function createHandoffTicket({ user, message, sessionId, category, context }) {
  const categoryInfo = category || categorizeHandoff(message, user?.userState);

  const ticket = {
    id: `handoff-${uuidv4().slice(0, 8)}`,
    sessionId: sessionId || uuidv4(),
    userEmail: user?.email || "unknown@local",
    userName: user?.name || "Unknown User",
    company: user?.company || "",
    category: categoryInfo,
    message: message || "No message provided",
    context: context || "",
    status: "open",
    priority: "normal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  handoffRequests.push(ticket);

  console.log(
    `[Handoff] Ticket ${ticket.id} created - ${categoryInfo.label} from ${ticket.userEmail}`,
  );

  // Send email notification to the support team
  notifyHandoff(ticket).catch((err) =>
    console.error(`[Handoff] Email notification failed for ${ticket.id}:`, err.message)
  );

  return ticket;
}

async function notifyHandoff(ticket) {
  const supportEmail = process.env.SUPPORT_EMAIL || "info@zoikovertex.com";
  const safe = (value) => escapeHtml(value ?? "");

  const html = `
    <div style="font-family:Arial;padding:20px;background:#f5f5f5;">
      <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        <div style="background:#dc2626;color:#fff;padding:14px;font-weight:bold;font-size:16px;">
          🆘 Support Ticket — ${safe(ticket.category.label)}
        </div>
        <div style="padding:20px;font-size:14px;color:#333;line-height:1.6;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;font-weight:bold;color:#555;width:100px;">Ticket ID</td><td style="padding:6px 0;">${safe(ticket.id)}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#555;">Category</td><td style="padding:6px 0;">${safe(ticket.category.label)}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#555;">Status</td><td style="padding:6px 0;">${safe(ticket.status)}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#555;">Priority</td><td style="padding:6px 0;">${safe(ticket.priority)}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#555;">Created</td><td style="padding:6px 0;">${safe(new Date(ticket.createdAt).toLocaleString())}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
          <h3 style="margin:0 0 8px;font-size:14px;color:#555;">Customer Details</h3>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:4px 0;font-weight:bold;color:#555;width:100px;">Name</td><td style="padding:4px 0;">${safe(ticket.userName)}</td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#555;">Email</td><td style="padding:4px 0;"><a href="mailto:${encodeURIComponent(ticket.userEmail)}">${safe(ticket.userEmail)}</a></td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#555;">Company</td><td style="padding:4px 0;">${safe(ticket.company || "N/A")}</td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#555;">Session</td><td style="padding:4px 0;font-size:11px;word-break:break-all;">${safe(ticket.sessionId)}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
          <h3 style="margin:0 0 8px;font-size:14px;color:#555;">Message</h3>
          <div style="background:#f9f9f9;border-left:3px solid #dc2626;padding:12px;border-radius:4px;font-size:13px;color:#444;">
            ${safe(ticket.message || "No message provided").replace(/\n/g, "<br/>")}
          </div>
          ${ticket.context ? `<hr style="border:none;border-top:1px solid #eee;margin:16px 0;" /><h3 style="margin:0 0 8px;font-size:14px;color:#555;">Context</h3><div style="font-size:12px;color:#666;">${safe(ticket.context).replace(/\n/g, "<br/>")}</div>` : ""}
        </div>
        <div style="background:#f9f9f9;padding:12px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee;">
          ZoikoVertex — Custos Handoff System
        </div>
      </div>
    </div>
  `;

  await sendMail({
    to: supportEmail,
    subject: `[Support] ${ticket.category.label} — ${ticket.id} from ${ticket.userName}`,
    html,
    body: `Ticket ${ticket.id}: ${ticket.category.label} from ${ticket.userName} (${ticket.userEmail})\n\n${ticket.message}`,
  });
}

function getHandoffTickets({ status, email } = {}) {
  let tickets = [...handoffRequests];

  if (status) {
    tickets = tickets.filter((t) => t.status === status);
  }

  if (email) {
    tickets = tickets.filter((t) => t.userEmail === email);
  }

  return tickets.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}

function updateHandoffStatus(ticketId, status) {
  const ticket = handoffRequests.find((t) => t.id === ticketId);
  if (!ticket) return null;

  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  return ticket;
}

function getHandoffResponse(ticket) {
  const estimatedResponseMap = {
    sales: "within 24 hours",
    legal: "within 48 hours",
    security: "within 24 hours",
    billing: "within 12 hours",
    support: "within 4 hours",
  };

  const estimatedTime = estimatedResponseMap[ticket.category.route] || "within 24 hours";

  return {
    answer: `Your request (#${ticket.id}) has been submitted to our ${ticket.category.label} team, and someone will get back to you ${estimatedTime}. Thank you for reaching out!\n\nThanks for the conversation. If you have more questions about ZoikoVertex, I'm here.`,
    handoffId: ticket.id,
    category: ticket.category,
    estimatedResponse: estimatedTime,
    suggestions: [],
  };
}

module.exports = {
  createHandoffTicket,
  getHandoffTickets,
  updateHandoffStatus,
  getHandoffResponse,
  HANDOFF_CATEGORIES,
};
