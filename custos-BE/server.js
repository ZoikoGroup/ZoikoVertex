const path = require("node:path");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { connectDB } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");
const escalateRoutes = require("./routes/escalateRoutes");
const { errorHandler } = require("./middlewares/errorHandler");
const mailRoutes = require("./routes/mailRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const publicRoutes = require("./routes/publicRoutes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Behind Render / the VM reverse proxy, req.ip would otherwise be the proxy's
// address and every visitor would share one rate-limit bucket.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));

const allowedOrigins = new Set([
  process.env.CLIENT_URL || "http://localhost:3000",
  "https://app.getzoikovertex.com",
  "https://getzoikovertex.com",
  "https://zoikovertex.com",
  "https://www.zoikovertex.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5175",
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
        callback(null, true);
        return;
      }
      const error = new Error("Origin not allowed by CORS");
      error.statusCode = 403;
      error.expose = true;
      callback(error);
    },
    credentials: true,
  }),
);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.get("/health", (_req, res) => {
  res.json({ success: true, service: "zt-chatbot-server", status: "running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/escalate", escalateRoutes);
app.use("/api/mail", mailRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/public", publicRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(errorHandler);

// Supabase is cloud-hosted — connectDB just verifies the connection.
// Only listen when run directly, so tests can import the app.
if (require.main === module) {
  connectDB().finally(() => {
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use.`);
        return;
      }
      console.error("Server failed to start.", error);
    });
  });
}

module.exports = app;
