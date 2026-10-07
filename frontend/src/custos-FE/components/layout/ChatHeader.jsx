import { useEffect, useRef, useState } from "react";
import {
  HiOutlineClock,
  HiOutlineGlobeAlt,
  HiOutlineMoon,
  HiOutlineSun,
} from "react-icons/hi2";
import {
  HiOutlineTicket,
  HiOutlineChatAlt2,
} from "react-icons/hi";
import { TiThMenu } from "react-icons/ti";

import LangPanel, { LANGS } from "./LangPanel";
import HistoryPanel from "../panels/HistoryPanel";

export default function ChatHeader({
  theme,
  onToggleTheme,
  lang,
  onLangChange,
  openPanel,
  onTogglePanel,
  onClosePanel,
  sessions,
  onSelectSession,
  onNewChat,
  onSupportTicketClick,
}) {
  const isDark = theme === "dark";
  const panelRef = useRef(null);
  const [actionOpen, setActionOpen] = useState(false);

  const currentLanguage = LANGS.find((item) => item.code === lang) || LANGS[0];

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(event.target)) {
        onClosePanel();
        setActionOpen(false);
      }
    }
    setTimeout(() => {
      document.addEventListener("click", handleOutsideClick);
    }, 0);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [onClosePanel]);

  const iconButton = `flex h-9 min-w-9 items-center justify-center rounded-[12px] border transition-all duration-200 ${
    isDark
      ? "border-[rgba(43,154,217,0.25)] bg-[rgba(23,51,124,0.35)] text-[#7ac8f0] hover:border-[rgba(77,184,255,0.55)] hover:bg-[rgba(23,51,124,0.55)] hover:text-[#8ccdff]"
      : "border-[rgba(43,154,217,0.28)] bg-[rgba(43,154,217,0.07)] text-[#1a5fa8] hover:border-[rgba(43,154,217,0.55)] hover:bg-[rgba(43,154,217,0.15)] hover:text-[#17337c]"
  }`;

  const wideButton = `flex h-9 items-center gap-1.5 rounded-[12px] border px-2.5 text-[0.65rem] font-bold transition-all duration-200 ${
    isDark
      ? "border-[rgba(43,154,217,0.25)] bg-[rgba(23,51,124,0.35)] text-[#7ac8f0] hover:border-[rgba(77,184,255,0.55)] hover:bg-[rgba(23,51,124,0.55)] hover:text-[#8ccdff]"
      : "border-[rgba(43,154,217,0.28)] bg-[rgba(43,154,217,0.07)] text-[#1a5fa8] hover:border-[rgba(43,154,217,0.55)] hover:bg-[rgba(43,154,217,0.15)] hover:text-[#17337c]"
  }`;

  return (
    <header
      className={`relative flex items-center gap-3 border-b px-1 py-1 sm:px-5 sm:py-3 ${
        isDark
          ? "border-[rgba(43,154,217,0.1)] bg-[rgba(10,22,40,0.97)]"
          : "border-[rgba(43,154,217,0.18)] bg-[rgba(240,248,255,0.97)]"
      }`}
    >
      {/* ── Logo + Title + Badge ── */}
      <div className="flex flex-1 items-center gap-3 min-w-0 ">
        {/* ✅ FIXED LOGO ONLY */}
        <div className="relative flex items-center">
          {/* Desktop Logo */}
          <div className="hidden lg:flex h-12 w-12 items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
<img src="/images/chatbot/logo.png" alt="Logo" className="h-full w-full object-contain" />
          </div>

          {/* Mobile / Tablet Logo */}
          <div className="block lg:hidden h-12 w-12 rounded-full overflow-hidden border-2 border-[#2b9ad9] flex items-center justify-center shadow-md shadow-[rgba(43,154,217,0.2)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
<img src="/images/chatbot/logo.png" alt="Logo" className="h-full w-full object-contain" />
          </div>

          {/* Indicator */}
          <span className="absolute -bottom-0 -right-0 h-2 w-2 rounded-full bg-green-500 border border-white"></span>
        </div>

        {/* Name + badge */}
        <div className="flex min-w-0 flex-col gap-[6px]">
            <span
            className={`truncate font-black text-[1.5rem] leading-none bg-clip-text text-transparent ${
              isDark
                ? "bg-gradient-to-r from-[#4db8ff] via-[#7ac8f0] to-[#c8dafc]"
                : "bg-gradient-to-r from-[#17337c] via-[#2b9ad9] to-[#4db8ff]"
            }`}
          >
            CUSTOS
          </span>
          <span
            className={`inline-flex w-fit items-center rounded-full px-2 py-[2px] text-[0.6rem] font-black uppercase tracking-wider leading-none ${
              isDark
                ? "bg-[rgba(77,184,255,0.15)] text-[#4db8ff] ring-1 ring-[rgba(77,184,255,0.25)]"
                : "bg-[rgba(77,184,255,0.12)] text-[#2b9ad9] ring-1 ring-[rgba(77,184,255,0.3)]"
            }`}
          >
            ⚡ZoikoVertex Assistant
          </span>
        </div>
      </div>

      {/* ── Right actions ── */}
      <div
        className="relative flex items-center gap-1.5 shrink-0"
        ref={panelRef}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePanel("history");
          }}
          className={iconButton}
        >
          <HiOutlineClock className="h-[17px] w-[17px]" />
        </button>

        <button type="button" onClick={onToggleTheme} className={iconButton}>
          {isDark ? (
            <HiOutlineSun className="h-[17px] w-[17px]" />
          ) : (
            <HiOutlineMoon className="h-[17px] w-[17px]" />
          )}
        </button>

        {/* <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePanel("lang");
          }}
          className={`${wideButton} hidden sm:flex`}
        >
          <HiOutlineGlobeAlt className="h-[15px] w-[15px]" />
          {currentLanguage.short}
        </button> */}

        <div className="relative">
          <button
            type="button"
            onClick={() => setActionOpen((p) => !p)}
            className={wideButton}
          >
            <TiThMenu className="h-[15px] w-[15px]" />
            <span className="hidden sm:inline">MENU</span>
          </button>

          {actionOpen && (
            <div
              className={`absolute right-0 mt-2 w-44 rounded-xl border shadow-xl z-50 overflow-hidden ${
                isDark
              ? "border-[rgba(43,154,217,0.16)] bg-[rgba(10,22,40,0.98)]"
              : "border-[rgba(43,154,217,0.2)] bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActionOpen(false);
                  onNewChat();
                }}
                className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-all ${
                  isDark
                    ? "text-[#a8c8e8] hover:bg-[rgba(43,154,217,0.08)] hover:text-[#d8eeff]"
                    : "text-[#1a5fa8] hover:bg-[rgba(43,154,217,0.12)] hover:text-[#17337c]"
                }`}
              >
                <HiOutlineChatAlt2 className="h-4 w-4 shrink-0" /> New
                Conversation
              </button>

              <button
                type="button"
                onClick={() => {
                  setActionOpen(false);
                  onSupportTicketClick();
                }}
                className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-all ${
                  isDark
                    ? "text-[#a8c8e8] hover:bg-[rgba(43,154,217,0.08)] hover:text-[#d8eeff]"
                    : "text-[#1a5fa8] hover:bg-[rgba(43,154,217,0.12)] hover:text-[#17337c]"
                }`}
              >
                <HiOutlineTicket className="h-4 w-4 shrink-0" /> Raise Support
                Ticket
              </button>
            </div>
          )}
        </div>

        {openPanel === "history" && (
          <HistoryPanel
            sessions={sessions}
            onClose={onClosePanel}
            onSelect={onSelectSession}
            onNewChat={onNewChat}
            theme={theme}
          />
        )}

        {openPanel === "lang" && (
          <LangPanel
            current={lang}
            onChange={onLangChange}
            onClose={onClosePanel}
            theme={theme}
          />
        )}
      </div>
    </header>
  );
}
