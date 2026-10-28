// ─────────────────────────────────────────────────────────────────────────────
// Published post metadata service.
//
// Backs the Workflows "Published Content" detail view: for a published
// publish_intent, resolve the platform post ID (saved at publish time in
// publish_intents.platform_posts, or found by caption match for posts published
// before that column existed) and fetch the live post from Meta — permalink,
// media, caption, timestamp. Threads, Instagram and Facebook only.
//
// Graph URLs carry access_token in the query string: never log them.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '../shared/supabase';
import { logger } from '../shared/logger';

const THREADS_BASE = 'https://graph.threads.net/v1.0';
const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

const THREADS_FIELDS = 'id,text,timestamp,media_type,media_url,thumbnail_url,permalink,username,shortcode,children{id,media_type,media_url,thumbnail_url}';
const INSTAGRAM_FIELDS = 'id,caption,timestamp,media_type,media_product_type,media_url,thumbnail_url,permalink,username,children{media_type,media_url,thumbnail_url}';
const FACEBOOK_POST_FIELDS = 'id,message,created_time,full_picture,permalink_url';
const FACEBOOK_VIDEO_FIELDS = 'id,description,created_time,picture,source,permalink_url';

// Statuses worth a Meta lookup even with no saved post id. APPROVED is included because an
// approved intent can be live on the platform while its status was never moved to PUBLISHED.
const LOOKUP_STATUSES = ['PUBLISHED', 'APPROVED'];

// Caption-match backfill: how far back before intent.created_at to look, and how many pages to scan.
const MATCH_LOOKBACK_MS = 60 * 60 * 1000;
const MATCH_PAGE_SIZE = 100;
const MATCH_MAX_PAGES = 3;

export const META_PLATFORMS = ['threads', 'instagram', 'facebook'] as const;
export type MetaPlatform = typeof META_PLATFORMS[number];

export function isMetaPlatform(platform: unknown): platform is MetaPlatform {
  return typeof platform === 'string' && (META_PLATFORMS as readonly string[]).includes(platform.toLowerCase());
}

export interface PlatformPostRef {
  platform: string;
  account_id: string;
  post_id: string;
  kind?: 'video' | 'post';
  matched?: boolean;
  saved_at?: string;
}

export interface MetaPostMedia {
  media_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
}

export interface MetaPostDetails extends MetaPostMedia {
  id: string;
  text: string | null;
  timestamp: string | null;
  permalink: string | null;
  username: string | null;
  children: MetaPostMedia[];
}

export interface MetaFetchResult {
  meta: MetaPostDetails | null;
  raw: Record<string, unknown> | null;
  error: string | null;
}

export interface PublishedPostMetaEntry {
  platform: string;
  account_id: string;
  account_name: string | null;
  post_id: string | null;
  matched: boolean;
  meta: MetaPostDetails | null;
  raw: Record<string, unknown> | null;
  error: string | null;
}

export type PublishedPostMetaStatus = 'ok' | 'not_published' | 'unsupported_platform' | 'no_account' | 'scheduled';

export interface PublishedPostMetaResult {
  status: PublishedPostMetaStatus;
  platform: string | null;
  posts: PublishedPostMetaEntry[];
}

interface MetaAccount {
  id: string;
  platform: string;
  account_handle: string;
  account_name: string | null;
  access_token: string;
}

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Meta error → 'token_expired' for OAuth code 190, else the Meta message. null when the body is not an error. */
function metaError(body: Json): string | null {
  const err = body.error as Json | undefined;
  if (!err) return null;
  if (err.code === 190) return 'token_expired';
  return str(err.message) || 'Meta API error';
}

function buildUrl(base: string, path: string, params: Record<string, string>): string {
  return `${base}/${path}?${new URLSearchParams(params).toString()}`;
}

async function getJson(url: string): Promise<Json> {
  const res = await fetch(url);
  return (await res.json()) as Json;
}

/**
 * Caption actually sent to `platform`. Mirrors ExecutionService.publishIntent:
 * content is either plain text or a JSON object keyed by platform.
 */
export function extractPlatformCaption(content: string | null | undefined, platform: string): string {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed[platform] === 'string') return parsed[platform];
      const first = Object.values(parsed)[0];
      return typeof first === 'string' ? first : content;
    }
  } catch {
    // plain-text caption
  }
  return content;
}

function normalizeChildren(raw: Json): MetaPostMedia[] {
  const data = (raw.children as Json | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((child) => {
    const c = child as Json;
    return { media_type: str(c.media_type), media_url: str(c.media_url), thumbnail_url: str(c.thumbnail_url) };
  });
}

/** Map a Threads / Instagram / Facebook post object onto one shape. */
export function normalizeMetaPost(platform: string, raw: Json, kind?: 'video' | 'post'): MetaPostDetails {
  const id = String(raw.id ?? '');

  if (platform === 'facebook') {
    if (kind === 'video') {
      // Video permalink_url comes back as a path ("/page/videos/123/")
      const link = str(raw.permalink_url);
      return {
        id,
        text: str(raw.description),
        timestamp: str(raw.created_time),
        media_type: 'VIDEO',
        media_url: str(raw.source),
        thumbnail_url: str(raw.picture),
        permalink: link?.startsWith('/') ? `https://www.facebook.com${link}` : link,
        username: null,
        children: [],
      };
    }
    const picture = str(raw.full_picture);
    return {
      id,
      text: str(raw.message),
      timestamp: str(raw.created_time),
      media_type: picture ? 'IMAGE' : 'TEXT',
      media_url: picture,
      thumbnail_url: picture,
      permalink: str(raw.permalink_url),
      username: null,
      children: [],
    };
  }

  return {
    id,
    text: str(platform === 'instagram' ? raw.caption : raw.text),
    timestamp: str(raw.timestamp),
    media_type: platform === 'instagram' && raw.media_product_type === 'REELS' ? 'REELS' : str(raw.media_type),
    media_url: str(raw.media_url),
    thumbnail_url: str(raw.thumbnail_url),
    permalink: str(raw.permalink),
    username: str(raw.username),
    children: normalizeChildren(raw),
  };
}

/** Fetch one post from Meta and normalise it. Never throws. */
export async function fetchMetaPost(
  platform: string,
  postId: string,
  token: string,
  kind?: 'video' | 'post',
): Promise<MetaFetchResult> {
  const p = platform.toLowerCase();
  let url: string;
  if (p === 'threads') {
    url = buildUrl(THREADS_BASE, postId, { fields: THREADS_FIELDS, access_token: token });
  } else if (p === 'instagram') {
    url = buildUrl(GRAPH_BASE, postId, { fields: INSTAGRAM_FIELDS, access_token: token });
  } else if (p === 'facebook') {
    const fields = kind === 'video' ? FACEBOOK_VIDEO_FIELDS : FACEBOOK_POST_FIELDS;
    url = buildUrl(GRAPH_BASE, postId, { fields, access_token: token });
  } else {
    return { meta: null, raw: null, error: 'unsupported_platform' };
  }

  try {
    const raw = await getJson(url);
    const error = metaError(raw);
    if (error) return { meta: null, raw: null, error };
    return { meta: normalizeMetaPost(p, raw, kind), raw, error: null };
  } catch (err) {
    return { meta: null, raw: null, error: err instanceof Error ? err.message : 'Request to Meta failed' };
  }
}

/**
 * Backfill for posts published before platform_posts existed: list the account's
 * posts since shortly before the intent was created and find the one whose text
 * equals the caption (whitespace-insensitive). Earliest match at/after createdAt wins.
 */
export async function findMetaPostByCaption(
  platform: string,
  account: Pick<MetaAccount, 'account_handle' | 'access_token'>,
  caption: string,
  createdAtIso: string | null,
): Promise<{ id: string | null; error: string | null }> {
  const target = normalizeText(caption);
  if (!target) return { id: null, error: null };

  const p = platform.toLowerCase();
  const createdAt = createdAtIso ? new Date(createdAtIso).getTime() : NaN;
  const params: Record<string, string> = { limit: String(MATCH_PAGE_SIZE), access_token: account.access_token };
  if (!Number.isNaN(createdAt)) params.since = String(Math.floor((createdAt - MATCH_LOOKBACK_MS) / 1000));

  let url: string | null;
  if (p === 'threads') {
    url = buildUrl(THREADS_BASE, `${account.account_handle}/threads`, { fields: 'id,text,timestamp', ...params });
  } else if (p === 'instagram') {
    url = buildUrl(GRAPH_BASE, `${account.account_handle}/media`, { fields: 'id,caption,timestamp', ...params });
  } else if (p === 'facebook') {
    url = buildUrl(GRAPH_BASE, `${account.account_handle}/published_posts`, { fields: 'id,message,created_time', ...params });
  } else {
    return { id: null, error: 'unsupported_platform' };
  }

  const candidates: { id: string; ts: number }[] = [];
  try {
    for (let page = 0; page < MATCH_MAX_PAGES && url; page++) {
      const body = await getJson(url);
      const error = metaError(body);
      if (error) return { id: null, error };

      const items = Array.isArray(body.data) ? (body.data as Json[]) : [];
      for (const item of items) {
        const text = item.text ?? item.caption ?? item.message;
        if (normalizeText(text) !== target) continue;
        const ts = new Date(String(item.timestamp ?? item.created_time ?? '')).getTime();
        candidates.push({ id: String(item.id), ts: Number.isNaN(ts) ? 0 : ts });
      }
      url = str((body.paging as Json | undefined)?.next);
    }
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : 'Request to Meta failed' };
  }

  if (candidates.length === 0) return { id: null, error: null };
  candidates.sort((a, b) => a.ts - b.ts);
  const afterCreate = Number.isNaN(createdAt) ? undefined : candidates.find((c) => c.ts >= createdAt);
  return { id: (afterCreate ?? candidates[0]).id, error: null };
}

/**
 * Live Meta metadata for one published publish_intent, scoped to the workspace.
 * Returns null when the intent does not exist in this workspace.
 */
export async function getPublishedPostMeta(
  workspaceId: string,
  intentId: string,
): Promise<PublishedPostMetaResult | null> {
  // select('*') so this still works before migration 91 adds platform_posts
  const { data: intent, error } = await supabaseAdmin
    .from('publish_intents')
    .select('*')
    .eq('id', intentId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!intent) return null;

  const intentPlatform = str(intent.platform)?.toLowerCase() ?? null;
  const stored: PlatformPostRef[] = Array.isArray(intent.platform_posts) ? intent.platform_posts : [];
  const legacyPostId = str(intent.platform_post_id);
  const hasSavedPost = stored.length > 0 || !!legacyPostId;
  if (!hasSavedPost && !LOOKUP_STATUSES.includes(String(intent.status || '').toUpperCase())) {
    return { status: 'not_published', platform: intentPlatform, posts: [] };
  }
  if (intentPlatform && !isMetaPlatform(intentPlatform)) {
    return { status: 'unsupported_platform', platform: intentPlatform, posts: [] };
  }

  const targetIds: string[] = Array.isArray(intent.target_account_ids) ? intent.target_account_ids : [];
  if (targetIds.length === 0) return { status: 'no_account', platform: intentPlatform, posts: [] };

  const { data: accountRows, error: accountsError } = await supabaseAdmin
    .from('connected_accounts')
    .select('id, platform, account_handle, account_name, access_token')
    .in('id', targetIds)
    .eq('workspace_id', workspaceId);
  if (accountsError) throw accountsError;

  const allAccounts = (accountRows ?? []) as MetaAccount[];
  const accounts = allAccounts.filter((a) => isMetaPlatform(a.platform));
  if (accounts.length === 0) {
    return { status: allAccounts.length > 0 ? 'unsupported_platform' : 'no_account', platform: intentPlatform, posts: [] };
  }

  const newRefs: PlatformPostRef[] = [];

  const posts = await Promise.all(accounts.map(async (account): Promise<PublishedPostMetaEntry> => {
    const platform = account.platform.toLowerCase();
    const base = { platform, account_id: account.id, account_name: account.account_name ?? null };
    const fail = (err: string, postId: string | null = null): PublishedPostMetaEntry =>
      ({ ...base, post_id: postId, matched: false, meta: null, raw: null, error: err });

    if (!account.access_token) return fail('token_expired');

    let ref = stored.find((r) => r.account_id === account.id && r.platform === platform) ?? null;
    // Before platform_posts existed, FB/IG publishes saved one ID in platform_post_id.
    const isLegacy = !ref && !!legacyPostId && platform !== 'threads' && (!intentPlatform || intentPlatform === platform);
    if (isLegacy) ref = { platform, account_id: account.id, post_id: legacyPostId as string };

    if (ref) {
      const result = await fetchMetaPost(platform, ref.post_id, account.access_token, ref.kind);
      // A legacy FB id can be a photo id that has no post fields: fall through to caption match.
      if (!result.error || result.error === 'token_expired' || !isLegacy) {
        if (isLegacy && !result.error) newRefs.push({ ...ref, saved_at: new Date().toISOString() });
        return { ...base, post_id: ref.post_id, matched: !!ref.matched, ...result };
      }
    }

    const caption = extractPlatformCaption(intent.content, platform);
    const found = await findMetaPostByCaption(platform, account, caption, str(intent.created_at));
    if (found.error) return fail(found.error);
    if (!found.id) return fail('not_found');

    newRefs.push({ platform, account_id: account.id, post_id: found.id, matched: true, saved_at: new Date().toISOString() });
    const result = await fetchMetaPost(platform, found.id, account.access_token);
    return { ...base, post_id: found.id, matched: true, ...result };
  }));

  if (newRefs.length > 0) {
    const { error: saveError } = await supabaseAdmin
      .from('publish_intents')
      .update({ platform_posts: [...stored, ...newRefs] })
      .eq('id', intentId)
      .eq('workspace_id', workspaceId);
    if (saveError) logger.warn({ saveError, intentId }, '[post-meta] failed to save resolved platform_posts (non-fatal)');
  }

  return { status: 'ok', platform: intentPlatform ?? accounts[0].platform.toLowerCase(), posts };
}
