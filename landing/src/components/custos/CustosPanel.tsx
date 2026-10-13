"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Box,
  CalendarDays,
  Ellipsis,
  ExternalLink,
  FileText,
  Link2,
  LogIn,
  Lock,
  MessageCircleQuestion,
  Minus,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  User,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
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
  type CustosHighlight,
  type CustosLink,
  type CustosQuickAction,
} from "./custosClient";
import { trackCustos } from "./analytics";

// Public website Custos (PUBLIC_WEB). Answers come only from the approved
// public knowledge served by custos-BE; this component is presentation only.

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  links?: CustosLink[];
  suggestions?: string[];
  highlights?: CustosHighlight[];
  isError?: boolean;
};

const MESSAGES_KEY = "zv-custos-messages";
const MAX_STORED_MESSAGES = 40;
const MOBILE_QUERY = "(max-width: 639px)";

const ICONS: Record<string, LucideIcon> = {
  box: Box,
  users: Users,
  shield: ShieldCheck,
  tag: Tag,
  calendar: CalendarDays,
  link: Link2,
  workflow: Workflow,
  chart: BarChart3,
  file: FileText,
};

function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || MessageCircleQuestion;
}

// Only ZoikoVertex destinations become clickable links; any other URL in an
// answer is shown as plain text.
const LINK_HOSTS = new Set([
  "zoikovertex.com",
  "www.zoikovertex.com",
  "getzoikovertex.com",
  "app.getzoikovertex.com",
]);
const TOKEN_PATTERN = /(https?:\/\/[^\s)<>"']+|[\w.+-]+@zoikovertex\.com)/g;
const LINK_CLASS = "font-medium text-[#1D4ED8] underline decoration-1 underline-offset-2 hover:text-[#1E40AF] break-words";

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

function normalizeQuickActions(actions: CustosContext["quickActions"]): CustosQuickAction[] {
  return (actions || []).map((action) =>
    typeof action === "string" ? { label: action, prompt: action, icon: "" } : action,
  );
}

function linkPathForAnalytics(href: string) {
  try {
    const url = new URL(href);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "mailto";
  }
}

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

function Paragraphs({ text, id }: { text: string; id: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((para) => para.trim())
        .map((para, pi) => (
          <p key={`${id}-${pi}`} className="mt-2 first:mt-0">
            {para.split("\n").map((line, li, lines) => (
              <Fragment key={li}>
                {renderInline(line, `${id}-${pi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        ))}
    </>
  );
}

// Lead with the answer's first sentence as a headline (as in the design),
// followed by the rest of the approved answer text.
function splitHeadline(text: string): { headline: string | null; body: string } {
  const match = text.match(/^([^\n]{20,200}?[.!?])[ \t]+([\s\S]+)$/);
  if (!match) return { headline: null, body: text };
  return { headline: match[1], body: match[2] };
}

function AssistantAnswer({ message }: { message: ChatMessage }) {
  const { headline, body } = message.isError ? { headline: null, body: message.text } : splitHeadline(message.text);
  return (
    <>
      {headline && (
        <p className="text-[15px] font-semibold leading-snug text-[#0B1B3F]">{renderInline(headline, `${message.id}-h`)}</p>
      )}
      <div className={`text-[14px] leading-relaxed text-[#4B5563] ${headline ? "mt-2" : ""}`}>
        <Paragraphs id={message.id} text={body} />
      </div>
      {message.highlights && message.highlights.length > 0 && (
        <ul className="mt-3 divide-y divide-[#E5EAF2] rounded-xl bg-[#F6F9FD]">
          {message.highlights.map((row) => {
            const Icon = iconFor(row.icon);
            return (
              <li key={row.title} className="flex items-start gap-3 px-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F0FE] text-[#2563EB]">
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-[#0B1B3F]">{row.title}</span>
                  <span className="block text-[13px] leading-snug text-[#4B5563]">{row.description}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function TypingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ animationDelay: `${i * 0.18}s` }}
          className="h-1.5 w-1.5 rounded-full bg-[#2563EB] opacity-80 motion-safe:animate-bounce"
        />
      ))}
    </div>
  );
}

const BotAvatar = (
  <Image
    src="/images/chatbot/zoikovertex-favicon.png"
    alt=""
    width={36}
    height={36}
    className="h-9 w-9 shrink-0 rounded-xl object-contain"
  />
);

const iconButton =
  "flex h-9 w-9 items-center justify-center rounded-xl border border-[#E1E7F0] bg-white text-[#0B1B3F] transition-colors hover:bg-[#F1F6FD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]";
const menuItem =
  "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-[#0B1B3F] hover:bg-[#F1F6FD] focus-visible:bg-[#F1F6FD] focus-visible:outline-none";
const chipClass =
  "inline-flex min-h-[38px] items-center gap-2 rounded-full border border-[#D6E2F3] bg-white px-3.5 text-[13px] font-medium text-[#0B1B3F] transition-colors hover:border-[#2563EB] hover:bg-[#F1F6FD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]";

type Props = {
  context: CustosContext;
  open: boolean;
  onClose: () => void;
};

export default function CustosPanel({ context, open, onClose }: Props) {
  const pathname = usePathname() || "/";
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
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
  const quickActions = normalizeQuickActions(context.quickActions);

  // Persist the conversation for this browser tab session only.
  useEffect(() => {
    writeSession(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  }, [messages]);

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

  // Close the "more" menu on outside click.
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
            highlights: reply.highlights,
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

  const quickPrompts = new Set(quickActions.flatMap((action) => [action.label, action.prompt]));
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const related = (lastAssistant?.suggestions || []).filter((s) => !quickPrompts.has(s)).slice(0, 3);
  const remaining = context.maxMessageLength - input.length;

  return (
    <div
      id="custos-panel"
      ref={panelRef}
      role="dialog"
      aria-modal={isMobile ? true : undefined}
      aria-label="Custos, the ZoikoVertex assistant"
      aria-describedby={noticeId}
      onKeyDown={onPanelKeyDown}
      className={`zt-chat-panel fixed inset-0 z-[70] flex-col overflow-hidden bg-white text-[#0B1B3F] sm:inset-auto sm:bottom-[104px] sm:right-6 sm:h-[min(700px,calc(100vh-128px))] sm:w-[480px] sm:rounded-3xl sm:border sm:border-[#E5EAF2] ${
        open ? "flex" : "hidden"
      }`}
      style={{
        boxShadow: isMobile ? undefined : "0 24px 64px rgba(15, 35, 80, 0.18), 0 2px 6px rgba(15, 35, 80, 0.06)",
        paddingTop: isMobile ? "env(safe-area-inset-top)" : undefined,
        paddingBottom: isMobile ? "env(safe-area-inset-bottom)" : undefined,
        height: isMobile ? "100dvh" : undefined,
      }}
    >
      {/* ── Header ── */}
      <header className="flex items-center gap-3 border-b border-[#EEF2F7] px-4 py-3.5">
        <Image
          src="/images/chatbot/zoikovertex-favicon.png"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-2xl object-contain"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[20px] font-extrabold leading-tight tracking-wide text-[#0B1B3F]" aria-hidden="true">
            CUSTOS
          </p>
          <p className="truncate text-[13px] text-[#4B5563]">ZoikoVertex Assistant</p>
          <p className="flex items-center gap-1.5 text-[12px] text-[#4B5563]">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" aria-hidden="true" />
            Online
          </p>
        </div>

        <Image
          src="/images/logos/logo-wordmark.svg"
          alt="ZoikoVertex"
          width={235}
          height={36}
          className="hidden h-[14px] w-auto shrink-0 min-[400px]:block"
        />

        <div className="flex shrink-0 items-center gap-1.5" ref={menuRef}>
          <button type="button" onClick={close} className={iconButton} aria-label="Minimize chat" title="Minimize">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={restart} className={iconButton} aria-label="New conversation" title="New conversation">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className={iconButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More options"
              title="More options"
            >
              <Ellipsis className="h-4 w-4" aria-hidden="true" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[#E5EAF2] bg-white py-1 shadow-xl shadow-[rgba(15,35,80,0.12)]"
              >
                <a
                  role="menuitem"
                  href={context.contactSalesUrl}
                  onClick={() => trackCustos("custos_link_click", { destination: "contact-sales-menu" })}
                  className={menuItem}
                >
                  <UserRound className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" /> Talk to a person
                </a>
                <a role="menuitem" href={context.loginUrl} className={menuItem}>
                  <LogIn className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" /> Existing customer? Log in
                </a>
                <a role="menuitem" href={context.privacyUrl} className={menuItem}>
                  <Lock className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" /> Privacy Policy
                </a>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Conversation ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 flex gap-3.5 rounded-2xl bg-[#F1F6FD] p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E3EDFB] text-[#2563EB]">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-[#0B1B3F]">{context.welcomeTitle || "Welcome to ZoikoVertex"}</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[#4B5563]">{context.welcomeMessage}</p>
            <p id={noticeId} className="mt-2 text-[11.5px] leading-snug text-[#6B7280]">
              {context.privacyNotice}{" "}
              <a href={context.privacyUrl} className={LINK_CLASS}>
                Privacy Policy
              </a>
            </p>
          </div>
        </div>

        <div role="log" aria-live="polite" aria-relevant="additions">
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="zt-msg mb-4 flex justify-end gap-2.5">
                <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-[#E8F0FE] px-4 py-2.5 text-[14px] text-[#0B1B3F]">
                  <span className="sr-only">You: </span>
                  {message.text}
                </p>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF3FB] text-[#1E3A6E]" aria-hidden="true">
                  <User className="h-[18px] w-[18px]" />
                </span>
              </div>
            ) : (
              <div key={message.id} className="zt-msg mb-4 flex gap-2.5">
                {BotAvatar}
                <div className="min-w-0 max-w-[88%]">
                  <div
                    role={message.isError ? "alert" : undefined}
                    className={`rounded-2xl border bg-white px-4 py-3 ${
                      message.isError ? "border-[rgba(239,68,68,0.35)]" : "border-[#E5EAF2]"
                    }`}
                  >
                    <span className="sr-only">Custos: </span>
                    <AssistantAnswer message={message} />
                  </div>

                  {message.links && message.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.links.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          onClick={() => trackCustos("custos_link_click", { destination: linkPathForAnalytics(link.url) })}
                          className="inline-flex items-center gap-1 rounded-full border border-[#D6E2F3] bg-white px-3 py-1 text-[12px] font-medium text-[#1D4ED8] hover:border-[#2563EB]"
                        >
                          {link.label}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {sending && (
            <div className="zt-msg mb-4 flex gap-2.5">
              {BotAvatar}
              <div className="rounded-2xl border border-[#E5EAF2] bg-white px-4 py-2.5">
                <TypingDots label="Custos is typing" />
              </div>
            </div>
          )}
        </div>

        {!sending && related.length > 0 && (
          <div className="mb-3 ml-[46px] flex flex-wrap gap-1.5" role="group" aria-label="Related questions">
            {related.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="rounded-full bg-[#F1F6FD] px-3 py-1 text-[12px] font-medium text-[#1D4ED8] hover:bg-[#E3EDFB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {!sending && quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested topics">
            {quickActions.map((action) => {
              const Icon = iconFor(action.icon);
              return (
                <button key={action.label} type="button" onClick={() => send(action.prompt)} className={chipClass}>
                  <Icon className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Composer ── */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="shrink-0 px-4 pb-3 pt-2"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-[#D6E2F3] bg-white py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-[#2563EB]">
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
              event.target.style.height = `${Math.min(event.target.scrollHeight, 96)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything about ZoikoVertex..."
            className="max-h-24 min-h-[24px] flex-1 resize-none self-center bg-transparent py-2 text-base leading-snug text-[#0B1B3F] outline-none placeholder:text-[#6B7280] sm:text-[14px]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Send message"
            title="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1F6FEB] text-white shadow-[0_4px_12px_rgba(31,111,235,0.35)] transition hover:bg-[#1858C2] active:scale-95 disabled:opacity-40 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            <Send className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px] text-[#4B5563]">
          <span className="flex items-center gap-1.5">
            <UserRound className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
            <span>
              Need a human?{" "}
              <a
                href={context.contactSalesUrl}
                onClick={() => trackCustos("custos_link_click", { destination: "contact-sales-footer" })}
                className={LINK_CLASS}
              >
                Contact sales
              </a>
            </span>
          </span>
          <span className="hidden h-4 w-px shrink-0 bg-[#E1E7F0] min-[440px]:block" aria-hidden="true" />
          {remaining < 100 ? (
            <span aria-live="polite" className="shrink-0">
              {remaining} characters left
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[#6B7280]" aria-hidden="true" />
              Source-grounded • Governed responses
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
