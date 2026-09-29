import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useStore } from "../store/useStore";
import {
  endChatSession,
  fetchMailStatus,
  fetchHistory,
  fetchUserSessions,
  requestHandoff,
  sendMessage as sendChatMessage,
  uploadFile,
} from "../services/api";

import ChatHeader from "../components/layout/ChatHeader";
import MessageBubble from "../components/chat/MessageBubble";
import TypingDots from "../components/chat/TypingDots";
import Composer from "../components/chat/Composer";
import MailResponse from "../components/chat/MailResponse";

const WELCOME_TEXT =
  "Hi there! I'm your ZoikoVertex assistant.\n\nI'm here to help with platform governance, approval workflows, brand controls, pricing, security, trust docs, and anything else about ZoikoVertex.\n\nWhat can I help you with today?";

function createWelcomeMessage(text = WELCOME_TEXT) {
  return {
    id: `welcome-${Date.now()}`,
    role: "assistant",
    content: text,
    suggestions: [],
    citations: [],
    timestamp: new Date().toISOString(),
  };
}

function normalizeMessage(message, index = 0) {
  const meta = message.meta || message.metadata || {};
  return {
    id: message.id || message._id || `${message.role || "assistant"}-${index}`,
    role: message.role || "assistant",
    content: message.content ?? message.text ?? "",
    suggestions:
      message.suggestions ||
      message.quickReplies ||
      meta.suggestions ||
      [],
    citations: message.citations || meta.citations || [],
    timestamp: message.timestamp || new Date().toISOString(),
    nextAction: message.nextAction || null,
    file: message.file || meta.file || null,
    source: message.source || meta.source || null,
    model: message.model || meta.model || null,
    handoffId: message.handoffId || meta.handoffId || null,
    handoffCategory: message.handoffCategory || meta.handoffCategory || null,
    confidence: message.confidence ?? meta.confidence ?? null,
  };
}

function formatWaitTime(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export default function ChatPage() {
  const user = useStore((state) => state.user);
  const sessionId = useStore((state) => state.sessionId);
  const setSessionId = useStore((state) => state.setSessionId);
  const messages = useStore((state) => state.messages);
  const replaceMessages = useStore((state) => state.replaceMessages);
  const sessions = useStore((state) => state.sessions);
  const setSessions = useStore((state) => state.setSessions);
  const lang = useStore((state) => state.language);
  const setLang = useStore((state) => state.setLanguage);
  const theme = useStore((state) => state.theme);
  const toggleTheme = useStore((state) => state.toggleTheme);

  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);
  const [latestBotId, setLatestBotId] = useState(null);
  const [attachedFile, setAttachedFile] = useState(null);

  const bottomRef = useRef(null);
  const isDark = theme === "dark";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (!sessionId) return;

    fetchHistory(sessionId)
      .then((response) => {
        const historyMessages = (response.messages || []).map(normalizeMessage);
        setLatestBotId(null);
        replaceMessages(
          historyMessages.length ? historyMessages : [createWelcomeMessage()],
        );
      })
      .catch(() => {});
  }, [replaceMessages, sessionId]);

  useEffect(() => {
    if (!user?.email) return;

    fetchUserSessions()
      .then((response) => setSessions(response.sessions || []))
      .catch(() => {});
  }, [setSessions, user?.email, sessionId]);

  const handleFileSelect = useCallback(async (file) => {
    try {
      const result = await uploadFile(file);
      if (result.success) {
        setAttachedFile({
          url: result.url,
          name: result.name,
          size: result.size,
          type: result.mimetype,
        });
      } else {
        toast.error("File upload failed.");
      }
    } catch {
      toast.error("Could not upload file.");
    }
  }, []);

  const handleFileRemove = useCallback(() => {
    setAttachedFile(null);
  }, []);

  const handleHandoff = useCallback(async (text) => {
    if (!text || isTyping) return;

    let currentSessionId = sessionId;

    const nextMessages = [
      ...messages,
      normalizeMessage({
        id: `${Date.now()}-user`,
        role: "user",
        content: text,
      }),
    ];

    replaceMessages(nextMessages);
    setIsTyping(true);

    try {
      const response = await requestHandoff({
        sessionId: currentSessionId,
        message: text,
        user,
      });

      const botMsg = normalizeMessage({
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: response.message?.answer || "A support ticket has been created.",
        suggestions: response.message?.suggestions || [],
        source: "handoff",
        handoffId: response.message?.handoffId,
        handoffCategory: response.message?.handoffCategory,
      });

      setLatestBotId(botMsg.id);
      replaceMessages([...nextMessages, botMsg]);
    } catch {
      toast.error("Couldn't submit handoff request.");
      const errMsg = normalizeMessage({
        id: `${Date.now()}-error`,
        role: "assistant",
        content: "I couldn't process your handoff request. Please email info@zoikovertex.com directly.",
        suggestions: ["Try again"],
      });
      setLatestBotId(errMsg.id);
      replaceMessages([...nextMessages, errMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [isTyping, messages, replaceMessages, sessionId, user]);

  const sendMessage = useCallback(
    async (overrideText) => {
      const text = (overrideText ?? input).trim();
      if (!text || isTyping) return;

      const handoffTriggers = [
        "connect me to a human",
        "speak to a human",
        "talk to a human",
        "yes, connect me",
        "yes, connect me to a human",
        "i want to speak to a human",
        "human agent",
      ];
      if (handoffTriggers.some((t) => text.toLowerCase().includes(t))) {
        await handleHandoff(text);
        return;
      }

      let currentSessionId = sessionId;

      const nextMessages = [
        ...messages,
        normalizeMessage({
          id: `${Date.now()}-user`,
          role: "user",
          content: text,
          file: attachedFile || undefined,
        }),
      ];

      const filePayload = attachedFile
        ? {
            fileUrl: attachedFile.url,
            fileName: attachedFile.name,
            fileType: attachedFile.type,
          }
        : {};

      replaceMessages(nextMessages);
      setInput("");
      setAttachedFile(null);
      setIsTyping(true);

      try {
        const response = await sendChatMessage({
          sessionId: currentSessionId || null,
          message: text,
          user,
          language: lang,
          ...filePayload,
        });

        // The backend may start a fresh session if the stored one expired.
        if (response.sessionId && response.sessionId !== currentSessionId) {
          await setSessionId(response.sessionId);
          currentSessionId = response.sessionId;
        }

        const msgPayload = response.message || {};
        const botMsg = normalizeMessage({
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content:
            msgPayload.answer ||
            "I'm here to help. Could you clarify what you need?",
          suggestions: msgPayload.suggestions || [],
          nextAction: msgPayload.nextAction || null,
          citations: msgPayload.citations || [],
          source: msgPayload.source || null,
          model: msgPayload.model || null,
          confidence: msgPayload.confidence ?? null,
        });

        setLatestBotId(botMsg.id);
        replaceMessages([...nextMessages, botMsg]);
      } catch {
        toast.error("Couldn't reach the assistant. Check your connection.");

        const errMsg = normalizeMessage({
          id: `${Date.now()}-error`,
          role: "assistant",
          content:
            "I couldn't connect to the server right now.\n\nPlease try again, or contact support:\nEmail: info@zoikovertex.com",
          suggestions: ["Try again", "Speak to a human agent"],
        });

        setLatestBotId(errMsg.id);
        replaceMessages([...nextMessages, errMsg]);
      } finally {
        setIsTyping(false);
      }
    },
    [
      input,
      isTyping,
      lang,
      messages,
      replaceMessages,
      sessionId,
      user,
      setSessionId,
      attachedFile,
      handleHandoff,
    ],
  );

  const refreshSessions = useCallback(async () => {
    if (!user?.email) return;
    const response = await fetchUserSessions();
    setSessions(response.sessions || []);
  }, [setSessions, user]);

  const handleMailClick = useCallback(async () => {
    if (!user?.email) {
      toast.error("User session missing. Please log in again.");
      return;
    }

    try {
      const status = await fetchMailStatus();
      if (status?.allowed === false) {
        toast.error(
          `Support mail limit reached. Please try again in ${formatWaitTime(
            status.msBeforeNextReset || 86400 * 1000,
          )}.`,
          { duration: 6000 },
        );
        return;
      }
    } catch (_err) {
      // If status check fails, still allow the user to open the panel.
    }

    const alreadyOpen = messages.some((m) => m.isMail === true);
    if (alreadyOpen) return;

    const mailId = `mail-${Date.now()}`;

    const closeMail = () => {
      const current = useStore.getState().messages;
      replaceMessages(current.filter((m) => m.id !== mailId));
    };

    replaceMessages([
      ...messages,
      {
        id: mailId,
        role: "assistant",
        isMail: true,
        content: <MailResponse theme={theme} onClose={closeMail} />,
      },
    ]);
  }, [messages, replaceMessages, theme, user]);

  const handleNewChat = useCallback(async () => {
    if (sessionId && user?.email) {
      await endChatSession(sessionId).catch(() => {});
    }

    await setSessionId(null);
    setLatestBotId(null);
    setAttachedFile(null);

    replaceMessages([
      createWelcomeMessage(
        "Starting a new conversation. What can I help you with?",
      ),
    ]);

    setInput("");
    setOpenPanel(null);
  }, [sessionId, user, replaceMessages, setSessionId]);

  const handleSelectSession = useCallback(
    async (session) => {
      if (!session?.sessionId) return;

      try {
        const response = await fetchHistory(session.sessionId);
        const historyMessages = (response.messages || []).map(normalizeMessage);
        await setSessionId(session.sessionId, session.expiresAt || null);
        setLatestBotId(null);
        replaceMessages(
          historyMessages.length ? historyMessages : [createWelcomeMessage()],
        );
        setInput("");
        setOpenPanel(null);
      } catch {
        toast.error("Couldn't load that session.");
      }
    },
    [replaceMessages, setSessionId],
  );

  const clearChat = useCallback(() => {
    setLatestBotId(null);
    replaceMessages([
      createWelcomeMessage("Chat cleared. What can I help you with?"),
    ]);
  }, [replaceMessages]);

  return (
    <div
      className={`w-full h-full transition-colors duration-300 ${
        isDark         ? "bg-[rgba(10,22,40,1)]" : "bg-[rgba(240,248,255,1)]"
      }`}
    >
      <div
        className={`w-full h-full flex flex-col border rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 ${
          isDark
            ? "border-[rgba(43,154,217,0.12)] bg-[rgba(10,22,40,0.98)] shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
            : "border-[rgba(43,154,217,0.2)] bg-white shadow-[0_8px_40px_rgba(43,154,217,0.1)]"
        }`}
      >
        <ChatHeader
          theme={theme}
          onToggleTheme={toggleTheme}
          lang={lang}
          onLangChange={setLang}
          openPanel={openPanel}
          onTogglePanel={(panel) =>
            setOpenPanel((prev) => (prev === panel ? null : panel))
          }
          onClosePanel={() => setOpenPanel(null)}
          sessions={sessions}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onMailClick={handleMailClick}
        />

        <div
          className={`flex-1 overflow-y-auto p-3 sm:p-4 transition-colors duration-300 ${
            isDark ? "bg-[rgba(5,11,6,0.98)]" : "bg-white"
          }`}
        >
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              msg={message}
              onSuggestion={sendMessage}
              theme={theme}
              isNew={message.id === latestBotId}
              bottomRef={bottomRef}
            />
          ))}

          {isTyping && <TypingDots />}
          <div ref={bottomRef} />
        </div>

        <Composer
          input={input}
          setInput={setInput}
          isTyping={isTyping}
          onSend={sendMessage}
          onClear={clearChat}
          theme={theme}
          attachedFile={attachedFile}
          onFileSelect={handleFileSelect}
          onFileRemove={handleFileRemove}
        />
      </div>
    </div>
  );
}
