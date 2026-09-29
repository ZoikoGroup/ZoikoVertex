const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const nodemailer = require("nodemailer");
const { escapeHtml } = require("../utils/formatChatHistory");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter = null;

if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: parseInt(process.env.SMTP_PORT || "587", 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log("✅ Mail provider: SMTP (" + process.env.SMTP_HOST + ")");
} else {
  console.warn("⚠️  SMTP not configured — emails will not be sent");
}

// Mail is always sent from FROM_EMAIL. A user's address may only be used as
// replyTo — sending "from" an unverified user address is spoofing.
const sendMail = async ({ to, replyTo, subject, body, html }) => {
  if (!to || !subject) throw new Error("Missing required fields: to, subject");
  if (!emailRegex.test(to)) throw new Error("Invalid recipient email");
  if (replyTo && !emailRegex.test(replyTo)) throw new Error("Invalid reply-to email");

  const fromAddress = process.env.FROM_EMAIL;
  if (!fromAddress) throw new Error("FROM_EMAIL is not configured");
  if (!transporter) throw new Error("Mail service not configured (missing SMTP credentials)");

  const textBody = body || "User has reported an issue. Please view this email in HTML format.";
  const htmlBody =
    html ||
    `<div style="font-family: Arial; padding: 10px;">
      <h3>User Issue</h3>
      <p>${escapeHtml(textBody).replace(/\n/g, "<br/>")}</p>
    </div>`;

  await transporter.sendMail({
    from: fromAddress,
    to,
    replyTo: replyTo || fromAddress,
    subject,
    text: textBody,
    html: htmlBody,
  });
};

module.exports = { sendMail };