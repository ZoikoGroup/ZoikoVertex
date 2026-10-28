"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ImageOff,
  AlertCircle,
  Bot,
  Braces,
} from "lucide-react";
import { api } from "@/lib/api";
import { type PublishedContentItem, VERDICT_STYLES, platformKey, platformLabel } from "./PublishedContentPanel";

// Shape returned by GET /api/v1/agents/workflows/published-content/:id/meta
interface MetaPostMedia {
  media_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
}

interface MetaPostDetails extends MetaPostMedia {
  id: string;
  text: string | null;
  timestamp: string | null;
  permalink: string | null;
  username: string | null;
  children: MetaPostMedia[];
}

interface PostMetaEntry {
  platform: string;
  account_id: string;
  account_name: string | null;
  post_id: string | null;
  matched: boolean;
  meta: MetaPostDetails | null;
  raw: Record<string, unknown> | null;
  error: string | null;
}

interface PostMetaResponse {
  status: "ok" | "not_published" | "unsupported_platform" | "no_account" | "scheduled";
  platform: string | null;
  posts: PostMetaEntry[];
}

const VIDEO_EXT = /\.(mp4|mov|webm|avi|mkv|m4v|ogv)(\?.*)?$/i;

const POST_TYPE_LABELS: Record<string, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  REELS: "Reel",
  CAROUSEL_ALBUM: "Carousel",
  CAROUSEL: "Carousel",
  TEXT_POST: "Text",
  TEXT: "Text",
  AUDIO: "Audio",
  REPOST_FACADE: "Repost",
};

const STATUS_MESSAGES: Record<Exclude<PostMetaResponse["status"], "ok">, string> = {
  not_published: "This post hasn't been published yet, so there is no live post to show.",
  scheduled: "Live details appear once a scheduled post goes out.",
  unsupported_platform: "Live details are available for Threads, Instagram and Facebook posts only.",
  no_account: "The account this post was published to is no longer connected.",
};

function entryErrorMessage(error: string, platform: string): string {
  if (error === "token_expired") return `The ${platform} connection has expired. Reconnect the account to load live details.`;
  if (error === "not_found") return `Couldn't find this post on ${platform}. It may not be live yet, or its caption was edited or the post deleted.`;
  return error;
}

function isVideoMedia(type: string | null | undefined, url: string | null | undefined): boolean {
  const t = (type || "").toUpperCase();
  return t === "VIDEO" || t === "REELS" || (!!url && VIDEO_EXT.test(url));
}

/** Meta returns "+0000" offsets, which not every browser's Date parser accepts. */
function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked (non-secure context) — nothing to do
        }
      }}
      title={copied ? "Copied" : label}
      aria-label={label}
      className="shrink-0 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-success-text" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-[var(--border)] last:border-b-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">{label}</p>
      <div className="text-sm text-[var(--text-primary)]">{children}</div>
    </div>
  );
}

function SkeletonLine({ w = "w-2/3" }: { w?: string }) {
  return <div className={`h-4 ${w} rounded bg-[var(--surface-hover)] animate-pulse`} />;
}

function Empty() {
  return <span className="text-[var(--text-muted)]">—</span>;
}

/**
 * One image or video, shown at its natural aspect ratio. Tries each source in
 * order (Meta CDN first, then our stored copy) before giving up.
 */
function MediaFrame({ sources, type, poster }: { sources: string[]; type: string | null; poster: string | null }) {
  const [index, setIndex] = useState(0);
  const src = sources[index];

  if (!src) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/60">
        <ImageOff className="w-8 h-8" />
        <span className="text-xs">Media unavailable</span>
      </div>
    );
  }

  const next = () => setIndex((i) => i + 1);

  if (isVideoMedia(type, src)) {
    return (
      <video
        key={src}
        src={src}
        poster={poster || undefined}
        controls
        playsInline
        preload="metadata"
        onError={next}
        className="max-w-full max-h-[60vh] md:max-h-full w-auto h-auto object-contain"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt="Post media"
      onError={next}
      className="max-w-full max-h-[60vh] md:max-h-full w-auto h-auto object-contain"
    />
  );
}

function PostMedia({ item, meta }: { item: PublishedContentItem; meta: MetaPostDetails | null }) {
  const [slide, setSlide] = useState(0);

  // Carousel children > single Meta media > the copy stored with the post
  const slides: { sources: string[]; type: string | null; poster: string | null }[] =
    meta && meta.children.length > 0
      ? meta.children.map((c) => ({
          sources: [c.media_url, c.thumbnail_url].filter((s): s is string => !!s),
          type: c.media_type,
          poster: c.thumbnail_url,
        }))
      : meta?.media_url || meta?.thumbnail_url || item.mediaUrl
        ? [{
            sources: [meta?.media_url, item.mediaUrl, meta?.thumbnail_url].filter((s): s is string => !!s),
            type: meta?.media_type ?? null,
            poster: meta?.thumbnail_url ?? null,
          }]
        : [];

  if (slides.length === 0) {
    const text = meta?.text ?? item.content;
    return (
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-6 shadow-xl">
        <p className="text-base leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">
          {text || <span className="italic text-[var(--text-muted)]">No caption</span>}
        </p>
      </div>
    );
  }

  const current = Math.min(slide, slides.length - 1);
  const s = slides[current];

  return (
    <>
      <MediaFrame key={`${current}-${s.sources[0]}`} sources={s.sources} type={s.type} poster={s.poster} />
      {slides.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setSlide((current - 1 + slides.length) % slides.length)}
            aria-label="Previous media"
            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setSlide((current + 1) % slides.length)}
            aria-label="Next media"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px] font-semibold tabular-nums">
            {current + 1} / {slides.length}
          </span>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSlide(i)}
                aria-label={`Show media ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === current ? "w-4 bg-white" : "w-1.5 bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── Dialog ───────────────────────────────────────────────────────────────────

function PostDetailDialog({ item, onClose }: { item: PublishedContentItem; onClose: () => void }) {
  const [data, setData] = useState<PostMetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getPublishedPostMeta(item.id, item.source)
      .then((res) => {
        if (cancelled) return;
        if (res?.success) setData(res.data as PostMetaResponse);
        // A 404 without our JSON error body means the API server has no such route: it runs an older backend
        else if (res?.status === 404 && !res?.data?.error)
          setLoadError("The API server doesn't have the post details endpoint yet. Deploy or restart the backend with this change.");
        else setLoadError(res?.error || "Could not load post details");
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load post details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.source]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const entry = data?.posts[Math.min(activeIdx, Math.max(0, (data?.posts.length ?? 1) - 1))] ?? null;
  const meta = entry?.meta ?? null;
  const pKey = platformKey(entry?.platform ?? item.platform);
  const pLabel = platformLabel(pKey);
  const verdict = item.check ? VERDICT_STYLES[item.check.verdict] : null;

  const statusMessage = loadError
    ? loadError
    : data && data.status !== "ok"
      ? STATUS_MESSAGES[data.status]
      : entry?.error
        ? entryErrorMessage(entry.error, pLabel)
        : null;

  const mediaUrl = meta?.media_url ?? meta?.children.find((c) => c.media_url)?.media_url ?? null;
  const postType = meta?.media_type
    ? POST_TYPE_LABELS[meta.media_type.toUpperCase()] ?? meta.media_type
    : item.mediaUrl
      ? (VIDEO_EXT.test(item.mediaUrl) ? "Video" : "Image")
      : "Text";
  const publishedAt = formatTimestamp(meta?.timestamp);
  const account = meta?.username ? `@${meta.username}` : entry?.account_name ?? null;
  const rawJson = entry?.raw ?? meta;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-detail-title"
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="px-2 py-0.5 rounded-md bg-info-text/10 text-info-text border border-info-border/20 text-[10px] font-bold uppercase tracking-wide">
              {pLabel}
            </span>
            <h2 id="post-detail-title" className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {account || "Post details"}
            </h2>
            {item.status && (
              <span className="px-2 py-0.5 rounded-md bg-[var(--surface-hover)] text-[var(--text-secondary)] border border-[var(--border)] text-[10px] font-semibold uppercase tracking-wide">
                {item.status}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body: post | details ── */}
        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden grid md:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)] md:h-[min(78vh,760px)]">
          {/* Post */}
          <div className="relative bg-black flex items-center justify-center p-4 min-h-[280px] md:min-h-0 md:h-full overflow-hidden">
            <PostMedia key={entry?.post_id ?? "local"} item={item} meta={meta} />
          </div>

          {/* Details */}
          <div className="flex flex-col min-h-0 border-t md:border-t-0 md:border-l border-[var(--border)]">
            {data && data.posts.length > 1 && (
              <div className="flex gap-1 px-5 pt-3 shrink-0 overflow-x-auto">
                {data.posts.map((p, i) => (
                  <button
                    key={p.account_id}
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                      i === activeIdx
                        ? "bg-info-text/10 text-info-text border-info-border/20"
                        : "text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {platformLabel(platformKey(p.platform))} · {p.account_name || p.account_id.slice(0, 6)}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-0 md:overflow-y-auto px-5 py-2">
              {statusMessage && (
                <div className="my-3 flex items-start gap-2 p-3 rounded-xl bg-warning-text/10 border border-warning-border/20 text-xs text-warning-text">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                  <span>{statusMessage}</span>
                </div>
              )}

              <Detail label="Description">
                <p className="whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-y-auto">
                  {(meta?.text ?? item.content) || <span className="italic text-[var(--text-muted)]">No caption</span>}
                </p>
              </Detail>

              <Detail label="Post type">{loading ? <SkeletonLine w="w-1/4" /> : postType}</Detail>

              <Detail label="Permanent link">
                {loading ? (
                  <SkeletonLine />
                ) : meta?.permalink ? (
                  <div className="flex items-center gap-1 min-w-0">
                    <a
                      href={meta.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-info-text hover:underline"
                      title={meta.permalink}
                    >
                      {meta.permalink.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                    <CopyButton value={meta.permalink} label="Copy link" />
                  </div>
                ) : (
                  <Empty />
                )}
              </Detail>

              <Detail label="Published at">
                {loading ? (
                  <SkeletonLine w="w-1/2" />
                ) : publishedAt ? (
                  <span title={meta?.timestamp ?? undefined}>{publishedAt}</span>
                ) : item.createdAt ? (
                  <span>
                    {formatTimestamp(item.createdAt)}{" "}
                    <span className="text-xs text-[var(--text-muted)]">(created in ZoikoVertex)</span>
                  </span>
                ) : (
                  <Empty />
                )}
              </Detail>

              <Detail label="Post ID">
                {loading ? (
                  <SkeletonLine w="w-1/2" />
                ) : entry?.post_id ? (
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="font-mono text-xs truncate">{entry.post_id}</span>
                    <CopyButton value={entry.post_id} label="Copy post ID" />
                  </div>
                ) : (
                  <Empty />
                )}
              </Detail>

              <Detail label="Media URL">
                {loading ? (
                  <SkeletonLine />
                ) : mediaUrl ? (
                  <a
                    href={mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 min-w-0 text-info-text hover:underline"
                    title={mediaUrl}
                  >
                    <span className="truncate">{mediaUrl}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <Empty />
                )}
              </Detail>

              <Detail label="Risk check · Agent">
                <div className="flex items-center gap-2 flex-wrap">
                  {verdict && item.check ? (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide ${verdict.cls}`}>
                      {verdict.icon}
                      {verdict.label}
                      {item.check.risk > 0 && <span className="opacity-70">· {item.check.risk}%</span>}
                    </span>
                  ) : (
                    <Empty />
                  )}
                  <span className="flex items-center gap-1 text-xs text-success-text">
                    <Bot className="w-3.5 h-3.5" />
                    {item.agentName || "Agent"}
                  </span>
                </div>
                {item.check && item.check.verdict !== "safe" && item.check.flags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.check.flags.map((f, i) => (
                      <span
                        key={`${f.category}-${i}`}
                        title={`${f.category} · ${f.severity}`}
                        className="px-1.5 py-0.5 rounded bg-error-text/10 text-error-text border border-error-border/20 text-[10px] font-medium"
                      >
                        {f.text || f.category}
                      </span>
                    ))}
                  </div>
                )}
              </Detail>

              {entry?.matched && (
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Found on {pLabel} by matching the caption, since this post was published before post IDs were saved.
                </p>
              )}

              {rawJson && (
                <div className="my-3 rounded-xl border border-[var(--border)] overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--surface-hover)]/40">
                    <button
                      type="button"
                      onClick={() => setShowRaw((v) => !v)}
                      aria-expanded={showRaw}
                      className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Braces className="w-3.5 h-3.5" />
                      Raw response from {pLabel}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showRaw ? "rotate-180" : ""}`} />
                    </button>
                    <CopyButton value={JSON.stringify(rawJson, null, 2)} label="Copy JSON" />
                  </div>
                  {showRaw && (
                    <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-relaxed font-mono text-[var(--text-secondary)] bg-[var(--surface)]">
                      {JSON.stringify(rawJson, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-5 py-3 border-t border-[var(--border)]">
              {meta?.permalink ? (
                <a
                  href={meta.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-info-text text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  Open on {pLabel}
                  <ExternalLink className="w-4 h-4" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  title="No live link for this post"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[var(--border)] text-[var(--text-muted)] text-sm font-semibold opacity-60 cursor-not-allowed"
                >
                  {loading ? "Loading post…" : `No live ${pLabel} link`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Large post view for a Published Content card: the post on the left, its live Meta details on the right. */
export default function PostDetailModal({
  item,
  onClose,
}: {
  item: PublishedContentItem | null;
  onClose: () => void;
}) {
  if (!item) return null;
  // Keyed so all dialog state resets when a different card is opened
  return <PostDetailDialog key={`${item.source}-${item.id}`} item={item} onClose={onClose} />;
}
