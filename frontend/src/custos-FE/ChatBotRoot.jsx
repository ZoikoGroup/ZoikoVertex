import { useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import ChatPage from "./pages/ChatPage";
import { verifyUser, fetchHistory, getAuthToken } from "./services/api";
import { useStore } from "./store/useStore";

const ACCESS_DENIED_MESSAGE = "You do not have access to that conversation.";

function BootstrapState({ title, description }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[rgba(5,11,6,0.98)] p-5 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">
          Custos
        </p>
        <h2 className="mt-2 text-xl font-semibold">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-white/75">{description}</p>
      </div>
    </div>
  );
}

async function loadMainAppUser() {
  try {
    const { supabase } = await import("../lib/supabase");
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const meta = session.user.user_metadata || {};
      return {
        name: meta.full_name || meta.name || session.user.email?.split("@")[0] || "",
        email: session.user.email || "",
        company: meta.company || meta.organization_name || "",
      };
    }
  } catch {
    // fallback to localStorage
  }

  try {
    const email = (
      localStorage.getItem("email") ||
      localStorage.getItem("user_email") ||
      ""
    )
      .trim()
      .toLowerCase();
    if (!email) return null;

    return {
      name: (
        localStorage.getItem("name") ||
        localStorage.getItem("user_name") ||
        localStorage.getItem("full_name") ||
        ""
      ).trim(),
      email,
      company: (
        localStorage.getItem("company") ||
        localStorage.getItem("organization_name") ||
        localStorage.getItem("organization") ||
        ""
      ).trim(),
    };
  } catch {
    return null;
  }
}

export default function ChatBotRoot() {
  const hydrateSession = useStore((state) => state.hydrateSession);
  const hydrated = useStore((state) => state.hydrated);
  const user = useStore((state) => state.user);
  const sessionId = useStore((state) => state.sessionId);
  const setUserSession = useStore((state) => state.setUserSession);
  const setUserOnly = useStore((state) => state.setUserOnly);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const bootstrapAttemptedRef = useRef(false);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  useEffect(() => {
    if (!hydrated || bootstrapAttemptedRef.current) return;

    // A stored session is only usable with a Custos token; otherwise re-verify.
    const hasSession = Boolean(user?.email && sessionId);
    if (hasSession && getAuthToken()) {
      setBootstrapComplete(true);
      return;
    }

    let active = true;
    bootstrapAttemptedRef.current = true;

    loadMainAppUser().then(async (mainAppUser) => {
      if (!active) return;

      if (!mainAppUser?.email) {
        setBootstrapComplete(true);
        return;
      }

      // Set user without resetting messages (preserves chat context on retry)
      setUserOnly({ user: mainAppUser });
      setBootstrapComplete(true);

      // Upgrade to a proper backend session in the background.
      verifyUser({
        name: mainAppUser.name || mainAppUser.email.split("@")[0],
        email: mainAppUser.email,
        company: mainAppUser.company || "ZoikoVertex",
      })
        .then(async (response) => {
          if (!active) return;
          // Preserve local messages if backend has no history for this session
          const history = response.sessionId
            ? await fetchHistory(response.sessionId)
            : null;
          const backendMessages =
            history?.success && Array.isArray(history.messages) && history.messages.length > 0
              ? history.messages.map((m) => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  metadata: m.meta || {},
                }))
              : null;
          if (backendMessages) {
            await setUserSession(response);
          } else {
            // Update session without losing current messages
            const { messages: liveMessages } = useStore.getState();
            await setUserSession({ ...response, messages: liveMessages });
          }
        })
        .catch((error) => {
          if (!active) return;
          const message =
            error?.response?.data?.message ||
            error?.message ||
            "Unable to start Custos right now.";
          setBootstrapError(message);
          if (message !== ACCESS_DENIED_MESSAGE) {
            toast.error(message);
          }
        });
    });

    return () => {
      active = false;
    };
  }, [hydrated, user?.email, sessionId, setUserSession, setUserOnly]);

  const hasSession = Boolean(user?.email && sessionId);
  const needsBootstrap = hydrated && !hasSession && !bootstrapComplete;

  let content;

  if (!hydrated || needsBootstrap) {
    content = (
      <BootstrapState
        title="Starting Custos"
        description="Checking your session and preparing the assistant."
      />
    );
  } else if (bootstrapError && !hasSession) {
    content = (
      <div className="flex h-full w-full items-center justify-center bg-[rgba(5,11,6,0.98)] p-5 text-white">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">
            Custos
          </p>
          <h2 className="mt-2 text-xl font-semibold">Chatbot unavailable</h2>
          <p className="mt-3 text-sm leading-6 text-white/75">
            {bootstrapError}
          </p>
          <button
            type="button"
            onClick={() => {
              bootstrapAttemptedRef.current = false;
              setBootstrapError("");
              setBootstrapComplete(false);
            }}
            className="mt-5 inline-flex rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
          >
            Retry
          </button>
        </div>
      </div>
    );
  } else if (!user?.email) {
    content = (
      <div className="flex h-full w-full items-center justify-center bg-[rgba(5,11,6,0.98)] p-5 text-white">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">
            Custos
          </p>
          <h2 className="mt-2 text-xl font-semibold">Sign in required</h2>
          <p className="mt-3 text-sm leading-6 text-white/75">
            Please sign in to ZoikoVertex to use the assistant.
          </p>
        </div>
      </div>
    );
  } else {
    content = <ChatPage />;
  }

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            background: "#0d1f3a",
            color: "#c8dafc",
            border: "1px solid rgba(43,154,217,0.25)",
            fontSize: "13px",
            borderRadius: "10px",
          },
          success: {
            iconTheme: { primary: "#4db8ff", secondary: "#0d1f3a" },
          },
          error: {
            iconTheme: { primary: "#ef4444", secondary: "#0d1f3a" },
          },
        }}
      />
      {content}
    </>
  );
}
