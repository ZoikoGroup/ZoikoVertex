// Privacy-safe chat analytics (ZV-WEBCHAT-REQ-001 section 8, AC-13).
// Events carry only coarse, non-personal fields — never message text, answers,
// emails, or anything a visitor typed.

type GtagWindow = Window & {
  gtag?: (command: "event", name: string, params?: Record<string, string | number>) => void;
};

export type CustosEvent =
  | "custos_open"
  | "custos_message_sent"
  | "custos_answer"
  | "custos_link_click"
  | "custos_restart"
  | "custos_error";

export function trackCustos(event: CustosEvent, params: Record<string, string | number> = {}) {
  try {
    (window as GtagWindow).gtag?.("event", event, params);
  } catch {
    // Analytics must never break the chat.
  }
}
