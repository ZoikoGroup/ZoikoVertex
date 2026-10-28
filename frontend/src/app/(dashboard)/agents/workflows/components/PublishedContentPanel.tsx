"use client";

import React, { useMemo, useRef, useState } from "react";
import { Send, Clock, Bot, ImageIcon, FileText, ShieldCheck, ShieldAlert, ShieldX, Trash2, ListFilter, ChevronDown, Check } from "lucide-react";
import { Popover } from "@/components/ui/primitives";

export interface PublishCheck {
  verdict: "safe" | "review" | "block";
  severity: string;
  risk: number;
  flags: { category: string; text: string; severity: string }[];
}

export interface PublishedContentItem {
  id: string;
  source: "publish" | "schedule";
  platform: string | null;
  content: string;
  mediaUrl: string | null;
  status: string | null;
  createdAt: string | null;
  scheduledTime: string | null;
  agentName: string | null;
  check: PublishCheck | null;
}

export const VERDICT_STYLES: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  safe: { cls: "bg-success-text/10 text-success-text border-success-border/20", icon: <ShieldCheck className="w-3 h-3" />, label: "Safe" },
  review: { cls: "bg-warning-text/10 text-warning-text border-warning-border/20", icon: <ShieldAlert className="w-3 h-3" />, label: "Review" },
  block: { cls: "bg-error-text/10 text-error-text border-error-border/20", icon: <ShieldX className="w-3 h-3" />, label: "Blocked" },
};

// Known social platforms, in the order they appear in the platform menu.
const PLATFORM_LABELS: Record<string, string> = {
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  twitter: "X (Twitter)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};
const PLATFORM_ORDER = Object.keys(PLATFORM_LABELS);
const PLATFORM_ALIASES: Record<string, string> = {
  ig: "instagram",
  insta: "instagram",
  fb: "facebook",
  meta: "facebook",
  yt: "youtube",
  x: "twitter",
};
const ALL = "all";
const OTHER = "other";

/** Collapses the many spellings of a platform (e.g. "LinkedIn", "linkedin_personal", "x") to one key. */
export function platformKey(platform: string | null | undefined): string {
  const p = (platform || "").trim().toLowerCase();
  if (!p) return OTHER;
  if (PLATFORM_ALIASES[p]) return PLATFORM_ALIASES[p];
  const known = PLATFORM_ORDER.find((k) => p === k || p.startsWith(`${k}_`) || p.startsWith(`${k}-`));
  return known ?? p;
}

export function platformLabel(key: string): string {
  if (key === OTHER) return "Other";
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PublishedContentPanel({
  data,
  onDelete,
  onSelect,
}: {
  data?: PublishedContentItem[];
  onDelete?: (item: PublishedContentItem) => void;
  onSelect?: (item: PublishedContentItem) => void;
}) {
  const [platform, setPlatform] = useState<string>(ALL);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);

  // Post count per platform. Every known platform is listed (greyed out at 0)
  // so the menu always offers the full set; unknown platforms follow alphabetically.
  const platformCounts = useMemo(() => {
    const counts = new Map<string, number>(PLATFORM_ORDER.map((k) => [k, 0]));
    for (const item of data ?? []) {
      const k = platformKey(item.platform);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const extra = [...counts.keys()]
      .filter((k) => !PLATFORM_ORDER.includes(k) && k !== OTHER)
      .sort();
    const keys = [...PLATFORM_ORDER, ...extra, ...(counts.has(OTHER) ? [OTHER] : [])];
    return keys.map((k) => ({ key: k, label: platformLabel(k), count: counts.get(k) ?? 0 }));
  }, [data]);

  const visible = useMemo(
    () => (platform === ALL ? data ?? [] : (data ?? []).filter((item) => platformKey(item.platform) === platform)),
    [data, platform],
  );

  if (!data) {
    return <div className="h-48 animate-pulse bg-[var(--surface)] rounded-2xl" />;
  }

  const choose = (key: string) => {
    setPlatform(key);
    setMenuOpen(false);
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-hover)]/30">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-info-text/10 rounded-xl">
            <Send className="w-5 h-5 text-info-text" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Published Content
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Posts published or scheduled from the Publish Hub — each linked to its agent
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            ref={menuAnchor}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Filter posts by platform"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
              platform === ALL
                ? "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)]"
                : "bg-info-text/10 text-info-text border-info-border/20"
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            {platform === ALL ? "All platforms" : platformLabel(platform)}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={menuAnchor}
            align="end"
            className="fixed w-56"
          >
            {[{ key: ALL, label: "All platforms", count: data.length }, ...platformCounts].map((opt) => {
              const selected = platform === opt.key;
              const disabled = opt.key !== ALL && opt.count === 0;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => choose(opt.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                    selected
                      ? "bg-info-text/10 text-info-text font-semibold"
                      : disabled
                        ? "text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                        : "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 shrink-0 ${selected ? "" : "invisible"}`} />
                  <span className="flex-1 truncate">{opt.label}</span>
                  <span className="tabular-nums text-[var(--text-muted)]">{opt.count}</span>
                </button>
              );
            })}
          </Popover>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-info-text/10 text-info-text border border-info-border/20">
            {platform === ALL ? `${data.length} items` : `${visible.length} of ${data.length} items`}
          </span>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="p-10 text-center">
          <ImageIcon className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">
            No published content yet. Publish or schedule a post from the Publish Hub and it will appear here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center">
          <ImageIcon className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3" />
          <p className="text-sm text-[var(--text-muted)]">
            No {platformLabel(platform)} posts yet.
          </p>
          <button
            type="button"
            onClick={() => setPlatform(ALL)}
            className="mt-3 text-xs font-semibold text-info-text hover:underline"
          >
            Show all platforms
          </button>
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[420px] p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((item) => (
            <div
              key={`${item.source}-${item.id}`}
              {...(onSelect && {
                role: "button",
                tabIndex: 0,
                "aria-label": "View post details",
                onClick: () => onSelect(item),
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(item);
                  }
                },
              })}
              className={`flex gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)]/20 hover:border-[var(--border-hover)] transition-colors ${
                onSelect ? "cursor-pointer hover:bg-[var(--surface-hover)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-text/40" : ""
              }`}
            >
              {/* Media thumbnail */}
              <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
                {item.mediaUrl ? (
                  /\.(mp4|mov|webm|avi|mkv|m4v|ogv)(\?.*)?$/i.test(item.mediaUrl) ? (
                    <video
                      src={item.mediaUrl}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      onError={(e) => {
                        const vid = e.currentTarget;
                        vid.style.display = "none";
                        const fallback = vid.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.mediaUrl}
                      alt="post media"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget;
                        img.style.display = "none";
                        const fallback = img.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  )
                ) : null}
                <span
                  className="w-full h-full items-center justify-center"
                  style={{ display: item.mediaUrl ? "none" : "flex" }}
                >
                  <FileText className="w-5 h-5 text-[var(--text-muted)]" />
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  {item.platform && (
                    <span className="px-1.5 py-0.5 rounded-md bg-info-text/10 text-info-text border border-info-border/20 text-[9px] font-bold uppercase tracking-wide">
                      {item.platform}
                    </span>
                  )}
                  {(item.source === "schedule" || item.status?.toUpperCase() === "PUBLISHED") && (
                    <span className="px-1.5 py-0.5 rounded-md bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border)] text-[9px] font-semibold uppercase tracking-wide">
                      {item.source === "schedule" ? "Scheduled" : "Published"}
                    </span>
                  )}
                  {item.check && VERDICT_STYLES[item.check.verdict] && (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wide ${VERDICT_STYLES[item.check.verdict].cls}`}>
                      {VERDICT_STYLES[item.check.verdict].icon}
                      {VERDICT_STYLES[item.check.verdict].label}
                      {item.check.risk > 0 && <span className="opacity-70">· {item.check.risk}%</span>}
                    </span>
                  )}
                  {item.status && (
                    <span className="text-[9px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                      {item.status}
                    </span>
                  )}
                </div>

                <p className="text-xs text-[var(--text-primary)] line-clamp-2 leading-snug">
                  {item.content || <span className="text-[var(--text-muted)] italic">No caption</span>}
                </p>

                {/* Agent check: flagged terms (offensive / banned / PII / etc.) */}
                {item.check && item.check.verdict !== "safe" && item.check.flags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.check.flags.slice(0, 6).map((f, i) => (
                      <span
                        key={`${f.category}-${i}`}
                        title={`${f.category} · ${f.severity}`}
                        className="px-1.5 py-0.5 rounded bg-error-text/10 text-error-text border border-error-border/20 text-[9px] font-medium"
                      >
                        {f.text || f.category}
                      </span>
                    ))}
                  </div>
                )}
                {item.check && item.check.verdict === "safe" && (
                  <p className="mt-1.5 text-[10px] text-success-text/80 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> No policy or safety issues detected
                  </p>
                )}

                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <span className="flex items-center gap-1 text-success-text">
                    <Bot className="w-3 h-3" />
                    Agent
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {item.source === "schedule" && item.scheduledTime
                      ? new Date(item.scheduledTime).toLocaleString()
                      : timeAgo(item.createdAt)}
                  </span>
                </div>
              </div>

              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item);
                  }}
                  title="Remove from view"
                  aria-label="Remove post from view"
                  className="shrink-0 self-start p-1 rounded-md text-[var(--text-muted)] hover:text-error-text hover:bg-error-text/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
