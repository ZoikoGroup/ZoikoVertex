"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, MessageSquarePlus, Moon, Send, Sun, Trash2, UserRound, X } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  readSession,
  resetCustosSession,
  sendCustosMessage,
  writeSession,
  type CustosContext,
  type CustosLink,
} from "./custosClient";
import { trackCustos } from "./analytics";

// Visual design mirrors the in-platform Custos (frontend/src/custos-FE):
// ChatHeader, MessageBubble, TypingDots and Composer. Platform-only features
// (history, file upload, mail) are intentionally absent on the public site.

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  links?: CustosLink[];
  suggestions?: string[];
  isError?: boolean;
};

type Theme = "dark" | "light";

const MESSAGES_KEY = "zv-custos-messages";
const THEME_KEY = "zv-custos-theme";
const MAX_STORED_MESSAGES = 40;
const MOBILE_QUERY = "(max-width: 639px)";

// Only ZoikoVertex destinations become clickable links; any other URL in an
// answer is shown as plain text.
const LINK_HOSTS = new Set([
  "zoikovertex.com",
  "www.zoikovertex.com",
  "getzoikovertex.com",
  "app.getzoikovertex.com",
]);
const TOKEN_PATTERN = /(https?:\/\/[^\s)<>"']+|[\w.+-]+@zoikovertex\.com)/g;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(readSession(MESSAGES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function linkPathForAnalytics(href: string) {
  try {
    const url = new URL(href);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "mailto";
  }
}

const LINK_CLASS = "underline underline-offset-2 decoration-1 hover:opacity-80 transition-opacity text-[#2b9ad9] break-words";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Strip markdown emphasis markers — answers are rendered as plain text.
  const clean = text.replace(/\*\*/g, "");
  return clean.split(TOKEN_PATTERN).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;

    if (/^[\w.+-]+@zoikovertex\.com$/.test(part)) {
      return (
        <a key={key} href={`mailto:${part}`} className={LINK_CLASS}>
          {part}
        </a>
      );
    }

    if (/^https?:\/\//.test(part)) {
      const trimmed = part.replace(/[.,;:!?]+$/, "");
      const trailing = part.slice(trimmed.length);
      let host = "";
      try {
        host = new URL(trimmed).hostname;
      } catch {
        return <Fragment key={key}>{part}</Fragment>;
      }
      if (!LINK_HOSTS.has(host)) return <Fragment key={key}>{part}</Fragment>;

      const sameSite = host === window.location.hostname;
      return (
        <Fragment key={key}>
          <a
            href={trimmed}
            target={sameSite ? undefined : "_blank"}
            rel={sameSite ? undefined : "noopener noreferrer"}
            onClick={() => trackCustos("custos_link_click", { destination: linkPathForAnalytics(trimmed) })}
            className={LINK_CLASS}
          >
            {trimmed.replace(/^https?:\/\//, "")}
          </a>
          {trailing}
        </Fragment>
      );
    }

    return <Fragment key={key}>{part}</Fragment>;
  });
}

// Same paragraph spacing as MessageBubble.renderText in the platform.
function MessageText({ text, id }: { text: string; id: string }) {
  const paragraphs = text.split("\n\n");
  return (
    <span style={{ lineHeight: "1.45", display: "block" }}>
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n");
        return (
          <span key={`${id}-${pi}`}>
            {lines.map((line, li) => (
              <span key={li}>
                {renderInline(line, `${id}-${pi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
            {pi < paragraphs.length - 1 && <span style={{ display: "block", height: "0.85em" }} />}
          </span>
        );
      })}
    </span>
  );
}

function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ animationDelay: `${i * 0.18}s` }}
          className="h-1.5 w-1.5 rounded-full bg-[#4db8ff] opacity-80 motion-safe:animate-bounce"
        />
      ))}
    </div>
  );
}

type Props = {
  context: CustosContext;
  open: boolean;
  onClose: () => void;
};

export default function CustosPanel({ context, open, onClose }: Props) {
  const pathname = usePathname() || "/";
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pushedHistoryRef = useRef(false);
  const noticeId = useId();
  const isDark = theme === "dark";

  // Persist the conversation for this browser tab session only.
  useEffect(() => {
    writeSession(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
    else setMenuOpen(false);
  }, [open]);

  // Close the MENU dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const close = useCallback(() => {
    if (pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      // Consume the entry we pushed so Back keeps its normal meaning.
      window.history.back();
    }
    onClose();
  }, [onClose]);

  // Mobile: near-full-screen, lock page scroll (restored on close, so the
  // visitor's page position is preserved) and let the Back button close chat.
  useEffect(() => {
    if (!open || !isMobile) return;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    window.history.pushState({ custosChat: true }, "");
    pushedHistoryRef.current = true;
    const onPopState = () => {
      if (!pushedHistoryRef.current) return;
      pushedHistoryRef.current = false;
      onClose();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("popstate", onPopState);
    };
  }, [open, isMobile, onClose]);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || sending) return;

      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setSending(true);
      setMessages((current) => [...current, { id: makeId(), role: "user", text }]);
      trackCustos("custos_message_sent", { page: pathname });

      try {
        const reply = await sendCustosMessage(text, pathname);
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            text: reply.answer,
            links: reply.links,
            suggestions: reply.suggestions,
          },
        ]);
        trackCustos("custos_answer", { intent: reply.intent });
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : "Custos is unavailable right now.";
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            text: `${message} You can still reach us at ${context.contactSalesUrl} or info@zoikovertex.com.`,
            isError: true,
          },
        ]);
        trackCustos("custos_error");
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [context.contactSalesUrl, pathname, sending],
  );

  const restart = useCallback(() => {
    setMessages([]);
    setInput("");
    setMenuOpen(false);
    resetCustosSession();
    trackCustos("custos_restart");
    inputRef.current?.focus();
  }, []);

  const onPanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (menuOpen) setMenuOpen(false);
        else close();
        return;
      }

      // Trap focus only in the mobile full-screen (modal) presentation.
      if (event.key !== "Tab" || !isMobile || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [close, isMobile, menuOpen],
  );

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const followUps = messages.length === 0 ? context.quickActions : lastAssistant?.suggestions || [];
  const remaining = context.maxMessageLength - input.length;

  // ── Platform ChatHeader button styles ──
  const iconButton = `flex h-9 min-w-9 items-center justify-center rounded-[12px] border transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4db8ff] ${
    isDark
      ? "border-[rgba(43,154,217,0.25)] bg-[rgba(23,51,124,0.35)] text-[#7ac8f0] hover:border-[rgba(77,184,255,0.55)] hover:bg-[rgba(23,51,124,0.55)] hover:text-[#8ccdff]"
      : "border-[rgba(43,154,217,0.28)] bg-[rgba(43,154,217,0.07)] text-[#1a5fa8] hover:border-[rgba(43,154,217,0.55)] hover:bg-[rgba(43,154,217,0.15)] hover:text-[#17337c]"
  }`;
  const wideButton = `flex h-9 items-center gap-1.5 rounded-[12px] border px-2.5 text-[0.65rem] font-bold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4db8ff] ${
    isDark
      ? "border-[rgba(43,154,217,0.25)] bg-[rgba(23,51,124,0.35)] text-[#7ac8f0] hover:border-[rgba(77,184,255,0.55)] hover:bg-[rgba(23,51,124,0.55)] hover:text-[#8ccdff]"
      : "border-[rgba(43,154,217,0.28)] bg-[rgba(43,154,217,0.07)] text-[#1a5fa8] hover:border-[rgba(43,154,217,0.55)] hover:bg-[rgba(43,154,217,0.15)] hover:text-[#17337c]"
  }`;
  const menuItem = `flex w-full items-center gap-2 px-4 py-2.5 text-sm transition-all ${
    isDark
      ? "text-[#a8c8e8] hover:bg-[rgba(43,154,217,0.08)] hover:text-[#d8eeff]"
      : "text-[#1a5fa8] hover:bg-[rgba(43,154,217,0.12)] hover:text-[#17337c]"
  }`;
  const chipClass = `rounded-full border px-3 py-1 text-[0.71rem] font-medium transition-all active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4db8ff] ${
    isDark
      ? "border-[rgba(77,184,255,0.2)] bg-[rgba(13,31,58,0.65)] text-[#7ac8f0] hover:border-[#4db8ff] hover:bg-[rgba(23,51,124,0.3)] hover:text-[#4db8ff]"
      : "border-[rgba(43,154,217,0.35)] bg-[rgba(43,154,217,0.07)] text-[#2b9ad9] hover:border-[#4db8ff] hover:bg-[rgba(43,154,217,0.15)] hover:text-[#1a5fa8]"
  }`;
  const botBubble = isDark
    ? "rounded-2xl rounded-tl-sm border border-[rgba(77,184,255,0.15)] bg-[rgba(13,31,58,0.85)] px-4 py-3 text-[#c8dafc] text-sm shadow-md"
    : "rounded-2xl rounded-tl-sm border border-[rgba(43,154,217,0.25)] bg-white px-4 py-3 text-[#103040] text-sm shadow-md";

  const BotAvatar = (
    <div className="relative h-8 w-8 shrink-0">
      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-[#4db8ff] bg-[#e6f4f7]">
        <Image src="/images/chatbot/zoikovertex-favicon.png" alt="" width={32} height={32} className="h-full w-full object-contain" />
      </div>
    </div>
  );

  return (
    <div
      id="custos-panel"
      ref={panelRef}
      role="dialog"
      aria-modal={isMobile ? true : undefined}
      aria-label="Custos, the ZoikoVertex assistant"
      aria-describedby={noticeId}
      onKeyDown={onPanelKeyDown}
      className={`zt-chat-panel fixed inset-0 z-[70] flex-col overflow-hidden sm:inset-auto sm:bottom-[104px] sm:right-6 sm:h-[min(640px,calc(100vh-128px))] sm:max-h-[calc(100vh-128px)] sm:w-[380px] sm:rounded-[20px] ${
        open ? "flex" : "hidden"
      } ${isDark ? "bg-[rgba(10,22,40,0.98)]" : "bg-white"}`}
      style={{
        boxShadow: isMobile ? undefined : "0 16px 48px rgba(0,0,0,.3), 0 0 0 1px rgba(31,111,235,.15)",
        paddingTop: isMobile ? "env(safe-area-inset-top)" : undefined,
        paddingBottom: isMobile ? "env(safe-area-inset-bottom)" : undefined,
        height: isMobile ? "100dvh" : undefined,
      }}
    >
      {/* ── Header (platform ChatHeader) ── */}
      <header
        className={`relative flex items-center gap-3 border-b px-3 py-2 sm:px-5 sm:py-3 ${
          isDark
            ? "border-[rgba(43,154,217,0.1)] bg-[rgba(10,22,40,0.97)]"
            : "border-[rgba(43,154,217,0.18)] bg-[rgba(240,248,255,0.97)]"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative flex items-center">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-[#2b9ad9] shadow-md shadow-[rgba(43,154,217,0.2)] lg:rounded-none lg:border-0 lg:shadow-none">
              <Image src="/images/chatbot/logo.png" alt="" width={48} height={48} className="h-full w-full object-contain" />
            </div>
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-green-500" aria-hidden="true" />
          </div>

          <div className="flex min-w-0 flex-col gap-[6px]">
            <h2
              aria-hidden="true"
              className={`truncate bg-clip-text text-[1.5rem] font-black leading-none text-transparent ${
                isDark
                  ? "bg-gradient-to-r from-[#4db8ff] via-[#7ac8f0] to-[#c8dafc]"
                  : "bg-gradient-to-r from-[#17337c] via-[#2b9ad9] to-[#4db8ff]"
              }`}
            >
              CUSTOS
            </h2>
            <span
              aria-hidden="true"
              className={`inline-flex w-fit items-center rounded-full px-2 py-[2px] text-[0.6rem] font-black uppercase leading-none tracking-wider ${
                isDark
                  ? "bg-[rgba(77,184,255,0.15)] text-[#4db8ff] ring-1 ring-[rgba(77,184,255,0.25)]"
                  : "bg-[rgba(77,184,255,0.12)] text-[#2b9ad9] ring-1 ring-[rgba(77,184,255,0.3)]"
              }`}
            >
              ⚡ZoikoVertex Assistant
            </span>
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-1.5" ref={menuRef}>
          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={iconButton}
            aria-label={isDark ? "Switch chat to light theme" : "Switch chat to dark theme"}
            title={isDark ? "Light theme" : "Dark theme"}
          >
            {isDark ? <Sun className="h-[17px] w-[17px]" aria-hidden="true" /> : <Moon className="h-[17px] w-[17px]" aria-hidden="true" />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className={wideButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Chat menu"
            >
              <Menu className="h-[15px] w-[15px]" aria-hidden="true" />
              <span className="hidden sm:inline">MENU</span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className={`absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border shadow-xl ${
                  isDark ? "border-[rgba(43,154,217,0.16)] bg-[rgba(10,22,40,0.98)]" : "border-[rgba(43,154,217,0.2)] bg-white"
                }`}
              >
                <button type="button" role="menuitem" onClick={restart} className={menuItem}>
                  <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden="true" /> New Conversation
                </button>
                <a
                  role="menuitem"
                  href={context.contactSalesUrl}
                  onClick={() => trackCustos("custos_link_click", { destination: "contact-sales-menu" })}
                  className={menuItem}
                >
                  <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" /> Talk to a person
                </a>
              </div>
            )}
          </div>

          {/* On mobile the panel covers the launcher, so it needs its own close. */}
          <button type="button" onClick={close} className={`${iconButton} sm:hidden`} aria-label="Close chat">
            <X className="h-[17px] w-[17px]" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ── Messages ── */}
      <div className={`flex-1 overflow-y-auto p-3 sm:p-4 ${isDark ? "bg-[rgba(5,11,6,0.98)]" : "bg-white"}`}>
        <p
          id={noticeId}
          className={`mb-4 rounded-xl border px-3 py-2 text-[0.68rem] leading-5 ${
            isDark
              ? "border-[rgba(77,184,255,0.12)] bg-[rgba(13,31,58,0.5)] text-[#7a9cc0]"
              : "border-[rgba(43,154,217,0.2)] bg-[rgba(43,154,217,0.05)] text-[#3d6a8f]"
          }`}
        >
          {context.privacyNotice}{" "}
          <a href={context.privacyUrl} className={LINK_CLASS}>
            Privacy Policy
          </a>
        </p>

        <div role="log" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 && (
            <div className="zt-msg mb-4 flex w-full justify-start gap-2.5">
              {BotAvatar}
              <div className="flex max-w-[85%] flex-col items-start gap-2">
                <div className={botBubble}>
                  <MessageText id="welcome" text={context.welcomeMessage} />
                </div>
              </div>
            </div>
          )}

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="zt-msg mb-4 flex w-full justify-end gap-2.5">
                <div className="flex max-w-[85%] flex-col items-end gap-2">
                  <p className="whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#2b9ad9] to-[#1a5fa8] px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
                    <span className="sr-only">You: </span>
                    {message.text}
                  </p>
                </div>
                <div className="mt-0.5 shrink-0">
                  <div
                    className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-[13px] ${
                      isDark
                        ? "border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.07)]"
                        : "border border-[rgba(43,154,217,0.3)] bg-[rgba(43,154,217,0.1)]"
                    }`}
                  >
                    <Image src="/images/chatbot/avatar.svg" alt="" width={32} height={32} className="h-full w-full object-contain" />
                  </div>
                </div>
              </div>
            ) : (
              <div key={message.id} className="zt-msg mb-4 flex w-full justify-start gap-2.5">
                {BotAvatar}
                <div className="flex max-w-[85%] flex-col items-start gap-2">
                  <div
                    role={message.isError ? "alert" : undefined}
                    className={
                      message.isError
                        ? `${botBubble} !border-[rgba(239,68,68,0.4)]`
                        : botBubble
                    }
                  >
                    <span className="sr-only">Custos: </span>
                    <MessageText id={message.id} text={message.text} />
                  </div>

                  {message.links && message.links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.links.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          onClick={() => trackCustos("custos_link_click", { destination: linkPathForAnalytics(link.url) })}
                          className={chipClass}
                        >
                          {link.label} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {sending && (
            <div className="zt-msg mb-4 flex w-full justify-start gap-2.5">
              {BotAvatar}
              <div className={botBubble}>
                <TypingDots label="Custos is typing" />
              </div>
            </div>
          )}
        </div>

        {!sending && followUps.length > 0 && (
          <div className="ml-[42px] flex flex-wrap gap-1.5" aria-label="Suggested questions" role="group">
            {followUps.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => send(suggestion)} className={chipClass}>
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Composer (platform Composer) ── */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className={`shrink-0 border-t px-4 py-2 sm:px-5 sm:py-2.5 ${
          isDark ? "border-[rgba(255,255,255,0.05)] bg-[rgba(10,22,40,0.98)]" : "border-[rgba(43,154,217,0.16)] bg-white"
        }`}
      >
        <div
          className={`flex items-end gap-2.5 rounded-[18px] border px-4 py-1.5 transition-colors duration-200 ${
            isDark
              ? "border-[rgba(23,51,124,0.55)] bg-[rgba(10,22,40,0.96)] focus-within:border-[rgba(77,184,255,0.35)]"
              : "border-[rgba(43,154,217,0.26)] bg-white shadow-sm focus-within:border-[rgba(43,154,217,0.55)]"
          }`}
        >
          <label htmlFor="custos-input" className="sr-only">
            Ask Custos about ZoikoVertex
          </label>
          <textarea
            id="custos-input"
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={context.maxMessageLength}
            onChange={(event) => {
              setInput(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 80)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything about ZoikoVertex..."
            className={`flex-1 resize-none self-center bg-transparent py-1.5 text-base leading-relaxed outline-none sm:text-sm ${
              isDark ? "text-[#d8eeff] placeholder-[#5a7da0]" : "text-[#0a2d5c] placeholder-[#5a7da0]"
            }`}
            style={{ maxHeight: "80px", minHeight: "22px" }}
          />

          <button
            type="button"
            onClick={restart}
            title="Clear chat"
            aria-label="Clear chat"
            className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] transition-colors hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4db8ff] ${
              isDark ? "text-[#7ac8f0] hover:bg-[rgba(23,51,124,0.3)]" : "text-[#1a5fa8] hover:bg-[rgba(43,154,217,0.12)]"
            }`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="submit"
            disabled={sending || !input.trim()}
            title="Send"
            aria-label="Send message"
            className="zt-send mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4db8ff]"
          >
            <Send className="h-4 w-4 text-white" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-[0.58rem] tracking-wide text-[#5a7da0]">
          <a href={context.loginUrl} className="underline underline-offset-2 hover:text-[#2b9ad9]">
            Existing customer? Log in
          </a>
          {remaining < 100 ? (
            <span aria-live="polite">{remaining} characters left</span>
          ) : (
            <span className="select-none">Source-grounded · Governed responses</span>
          )}
        </div>
      </form>
    </div>
  );
}
