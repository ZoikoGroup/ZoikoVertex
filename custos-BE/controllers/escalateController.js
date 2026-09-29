const { v4: uuidv4 } = require("uuid");

const escalationStore = [];

async function escalateIssue(req, res) {
  try {
    const { sessionId, category, contactEmail, issueSummary, name, company } = req.body;

    if (!category || !contactEmail || !issueSummary) {
      return res.status(400).json({
        success: false,
        message: "category, contactEmail, and issueSummary are required.",
      });
    }

    if (
      typeof contactEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ||
      contactEmail.length > 254 ||
      String(issueSummary).length > 2000 ||
      String(name || "").length > 120 ||
      String(company || "").length > 120
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email and keep your details brief.",
      });
    }

    const validCategories = ["SALES", "LEGAL", "SECURITY", "BILLING", "SUPPORT"];
    if (!validCategories.includes(category.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
      });
    }

    const escalation = {
      id: uuidv4(),
      sessionId: sessionId || null,
      category: category.toUpperCase(),
      contactEmail,
      name: name || "",
      company: company || "",
      issueSummary,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    escalationStore.push(escalation);

    const responseTimeframes = {
      SALES: "within one business day",
      LEGAL: "within two business days",
      SECURITY: "within one business day",
      BILLING: "within one business day",
      SUPPORT: "within 4 hours during business hours",
    };

    const responseTimeframe = responseTimeframes[category.toUpperCase()] || "within one business day";

    const teamNames = {
      SALES: "Sales",
      LEGAL: "Legal",
      SECURITY: "Security Review",
      BILLING: "Billing",
      SUPPORT: "Support",
    };

    return res.json({
      success: true,
      escalationId: escalation.id,
      message: `Your enquiry has been routed to the ${teamNames[category.toUpperCase()] || "relevant"} team. They will respond ${responseTimeframe}.`,
    });
  } catch (error) {
    console.error("[EscalateController] Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to process escalation request.",
    });
  }
}

async function getEscalations(_req, res) {
  return res.json({
    success: true,
    escalations: escalationStore.slice(-50).reverse(),
  });
}

async function getEscalationById(req, res) {
  const escalation = escalationStore.find((e) => e.id === req.params.id);
  if (!escalation) {
    return res.status(404).json({ success: false, message: "Escalation not found." });
  }
  return res.json({ success: true, escalation });
}

module.exports = { escalateIssue, getEscalations, getEscalationById };