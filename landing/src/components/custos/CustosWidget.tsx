"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCustosContext,
  isCustosConfigured,
  readSession,
  writeSession,
  type CustosContext,
} from "./custosClient";
import { trackCustos } from "./analytics";

// The chat panel is only downloaded when a visitor first opens it, so the
// widget does not weigh on page load or Core Web Vitals.
const CustosPanel = dynamic(() => import("./CustosPanel"), { ssr: false });

const CONTEXT_KEY = "zv-custos-context";

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

// Same launcher as the in-platform Custos (frontend/src/components/ChatbotWidget.tsx).
const LAUNCHER_STYLES = `
  @keyframes ztBotFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  @keyframes ztBotPulse {
    0%, 100% { box-shadow: 0 8px 24px rgba(31,111,235,.35), 0 0 0 0 rgba(31,111,235,.45); }
    50%       { box-shadow: 0 8px 24px rgba(31,111,235,.45), 0 0 0 12px rgba(31,111,235,0); }
  }
  @keyframes ztPopUp {
    from { opacity: 0; transform: scale(0.92) translateY(16px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes msgIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .zt-fab {
    animation: ztBotFloat 3.6s ease-in-out infinite, ztBotPulse 2.8s ease-out infinite;
    transition: transform .18s cubic-bezier(.34,1.56,.64,1);
  }
  .zt-fab:hover  { transform: scale(1.08) !important; }
  .zt-fab:active { transform: scale(.96)  !important; }
  .zt-fab-open {
    animation: none !important;
    box-shadow: 0 8px 24px rgba(31,111,235,.5) !important;
  }
  .zt-chat-panel { animation: ztPopUp .26s cubic-bezier(.22,1,.36,1); }
  .zt-msg { animation: msgIn .22s ease both; }
  .zt-send {
    background: linear-gradient(135deg, #2b9ad9 0%, #1a5fa8 100%);
    box-shadow: 0 0 28px rgba(43,154,217,.35), inset 0 1px 0 rgba(255,255,255,.3);
  }
  @media (prefers-reduced-motion: reduce) {
    .zt-fab, .zt-chat-panel, .zt-msg { animation: none !important; }
    .zt-fab:hover, .zt-fab:active { transform: none !important; }
  }
`;

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M5 5L15 15M15 5L5 15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export default function CustosWidget() {
  const [context, setContext] = useState<CustosContext | null>(null);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // Availability check after the page is idle. If the chat service is not
  // configured or unreachable, the launcher never renders (fail closed) and
  // the website is unaffected.
  useEffect(() => {
    if (!isCustosConfigured) return;

    const cached = readSession(CONTEXT_KEY);
    if (cached) {
      try {
        setContext(JSON.parse(cached));
        return;
      } catch {
        writeSession(CONTEXT_KEY, null);
      }
    }

    let cancelled = false;
    const load = () => {
      fetchCustosContext()
        .then((result) => {
          if (cancelled) return;
          writeSession(CONTEXT_KEY, JSON.stringify(result));
          setContext(result);
        })
        .catch(() => {
          // Fail closed: no launcher.
        });
    };

    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(load, { timeout: 4000 });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(load, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const openPanel = useCallback(() => {
    setHasOpened(true);
    setOpen(true);
    trackCustos("custos_open");
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    // Return focus to the launcher for keyboard and screen-reader users.
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  }, []);

  if (!context) return null;

  return (
    <>
      <style>{LAUNCHER_STYLES}</style>

      {hasOpened && <CustosPanel context={context} open={open} onClose={closePanel} />}

      <button
        ref={launcherRef}
        type="button"
        onClick={open ? closePanel : openPanel}
        aria-label={open ? "Close Custos, the ZoikoVertex assistant" : "Chat with Custos, the ZoikoVertex assistant"}
        title="Custos · ZoikoVertex Assistant"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="custos-panel"
        className={`zt-fab fixed z-[70] flex h-[60px] w-[60px] cursor-pointer items-center justify-center rounded-full border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4db8ff] ${
          open ? "zt-fab-open hidden sm:flex" : ""
        }`}
        style={{
          right: "max(24px, env(safe-area-inset-right))",
          bottom: "max(24px, env(safe-area-inset-bottom))",
          background: "radial-gradient(circle at 30% 30%, #4F8DF7 0%, #1F6FEB 65%, #1858C2 100%)",
        }}
      >
        {open ? (
          <CloseIcon />
        ) : (
          <Image
            src="/images/chatbot/zoikovertex-favicon.png"
            alt=""
            width={32}
            height={32}
            className="rounded-full object-cover"
          />
        )}
      </button>
    </>
  );
}
