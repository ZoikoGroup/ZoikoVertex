// Client for the Custos PUBLIC_WEB API (custos-BE /api/public/*).
// The browser only ever holds an anonymous, tenantless visitor token — never
// model/provider credentials or platform tokens (ZV-WEBCHAT-REQ-001 AC-10).

const RAW_BASE = process.env.NEXT_PUBLIC_CUSTOS_API_URL || "";
const API_BASE = RAW_BASE
  ? `${RAW_BASE.replace(/\/$/, "").replace(/\/api$/, "")}/api/public`
  : "";

const TOKEN_KEY = "zv-custos-visitor";
const REQUEST_TIMEOUT_MS = 12000;

export const isCustosConfigured = Boolean(API_BASE);

export type CustosLink = { label: string; url: string };

export type CustosReply = {
  answer: string;
  suggestions: string[];
  links: CustosLink[];
  intent: string;
};

export type CustosContext = {
  assistantName: string;
  welcomeMessage: string;
  quickActions: string[];
  privacyNotice: string;
  privacyUrl: string;
  contactSalesUrl: string;
  supportUrl: string;
  loginUrl: string;
  maxMessageLength: number;
};

export class CustosError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Storage can be unavailable (private mode, blocked site data) — never let
// that break the page.
function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      credentials: "omit",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      throw new CustosError(body?.message || "Custos is unavailable right now.", response.status);
    }
    return body as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchCustosContext(): Promise<CustosContext> {
  const body = await request<{ context: CustosContext }>("/context");
  return body.context;
}

async function getVisitorToken(forceNew = false): Promise<string> {
  const existing = forceNew ? null : readSession(TOKEN_KEY);
  if (existing) return existing;
  const body = await request<{ token: string }>("/session", { method: "POST" });
  writeSession(TOKEN_KEY, body.token);
  return body.token;
}

export async function sendCustosMessage(message: string, pagePath: string): Promise<CustosReply> {
  const send = async (token: string) =>
    request<{ message: CustosReply }>("/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, pageContext: { path: pagePath } }),
    });

  try {
    return (await send(await getVisitorToken())).message;
  } catch (error) {
    // Expired visitor session: start a fresh anonymous one and retry once.
    if (error instanceof CustosError && error.status === 401) {
      return (await send(await getVisitorToken(true))).message;
    }
    throw error;
  }
}

export function resetCustosSession() {
  writeSession(TOKEN_KEY, null);
}

export { readSession, writeSession };
