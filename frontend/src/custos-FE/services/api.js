import axios from "axios";

const _rawBase = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_CUSTOS_API_URL) || "https://zoikovertex.onrender.com";
const _baseURL = _rawBase.endsWith("/api") ? _rawBase : _rawBase + "/api";

const api = axios.create({
  baseURL: _baseURL,
  timeout: 10000,
});

// ─── Custos auth token ───────────────────────────────────────────────────────
// custos-BE derives identity from this token only, never from user.email in
// the request body. It is issued by /auth/verify in exchange for the signed-in
// ZoikoVertex (Supabase) access token.
const TOKEN_KEY = "zt-chatbot-token";

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function clearAuthToken() {
  setAuthToken(null);
}

async function getSupabaseAccessToken() {
  try {
    const { supabase } = await import("../../lib/supabase");
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On an expired/invalid Custos token, re-verify once with the current
// Supabase session and retry the original request.
api.interceptors.response.use(undefined, async (error) => {
  const original = error.config;
  const isAuthError = error.response?.status === 401;
  const isVerifyCall = original?.url?.includes("/auth/verify");

  if (!isAuthError || isVerifyCall || !original || original._custosRetried) {
    throw error;
  }

  original._custosRetried = true;
  clearAuthToken();

  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) throw error;

  const { data } = await api.post(
    "/auth/verify",
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  setAuthToken(data?.token);
  original.headers.Authorization = `Bearer ${data?.token}`;
  return api(original);
});

// AUTH
// payload: { name, company } are display-only; identity comes from the
// Supabase access token.
export async function verifyUser(payload = {}) {
  const accessToken = await getSupabaseAccessToken();
  const { data } = await api.post(
    "/auth/verify",
    { name: payload.name, company: payload.company },
    accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  );
  setAuthToken(data?.token);
  return data;
}

// CHAT
export async function sendMessage(payload) {
  const { data } = await api.post("/chat", payload);
  return data;
}

export async function fetchHistory(sessionId) {
  const { data } = await api.get(`/chat/history/${sessionId}`);
  return data;
}

export async function fetchUserSessions() {
  const { data } = await api.get("/chat/sessions");

  return {
    ...data,
    sessions: (data.sessions || []).filter((s) => s.messageCount > 0),
  };
}

// SESSION MANAGEMENT
export async function endChatSession(sessionId) {
  const { data } = await api.patch(`/chat/sessions/${sessionId}/end`);
  return data;
}

export async function deleteChatSession(sessionId) {
  const { data } = await api.delete(`/chat/sessions/${sessionId}`);
  return data;
}

// FILE UPLOAD
export async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 60000,
  });
  return data;
}

// HUMAN HANDOFF
export async function requestHandoff(payload) {
  const { data } = await api.post("/chat/handoff", payload);
  return data;
}

export default api;
