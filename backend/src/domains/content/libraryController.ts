import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../../shared/supabase';
import { logger } from '../../shared/logger';
import { AuthRequest } from '../../shared/authMiddleware';
import { moderate } from '../../modules/safety/moderationService';
import { scanImage, type KeywordRule } from '../../modules/safety/imageScanner';
import { scanAudioVideo } from '../../modules/safety/audioVideoScanner';
import { v4 as uuidv4 } from 'uuid';
import { trackUsage } from '../monitoring/usageController';
import { createAuditEvent } from '../../services/auditTrail.service';
import { preserveEvidence } from '../../services/evidenceVault.service';
import { createApprovalItem } from '../../services/approval.service';
import { env } from '../../config/env';

// Derive the Supabase project hostname from SUPABASE_URL for URL origin validation.
// e.g. "https://abcxyz.supabase.co" → "abcxyz.supabase.co"
const SUPABASE_HOST = (() => {
  try { return new URL(env.SUPABASE_URL).hostname; } catch { return null; }
})();

// Hosts that are allowed to serve this project's storage. On a self-hosted deployment the
// backend talks to storage over localhost but browsers use the public gateway, so we also
// accept hosts listed in PUBLIC_STORAGE_HOSTS (comma-separated).
const ALLOWED_STORAGE_HOSTS: string[] = [
  ...(SUPABASE_HOST ? [SUPABASE_HOST] : []),
  ...(process.env.PUBLIC_STORAGE_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean),
];

function validateStorageUrls(urls: unknown): { ok: true; list: string[] } | { ok: false; error: string } {
  if (!Array.isArray(urls) || urls.length === 0)
    return { ok: false, error: 'urls must be a non-empty array' };
  if (urls.length > 20)
    return { ok: false, error: 'Maximum 20 URLs per asset' };
  for (const u of urls) {
    if (typeof u !== 'string') return { ok: false, error: 'Each URL must be a string' };
    try {
      const parsed = new URL(u);
      // Must be https
      if (parsed.protocol !== 'https:')
        return { ok: false, error: `URL must use HTTPS: ${u}` };
      // Must belong to this Supabase project
      if (ALLOWED_STORAGE_HOSTS.length > 0 && !ALLOWED_STORAGE_HOSTS.includes(parsed.hostname))
        return { ok: false, error: `URL must be from this project's storage (${ALLOWED_STORAGE_HOSTS.join(', ')}): ${parsed.hostname}` };
      // Must be a storage path (not an arbitrary endpoint)
      if (!parsed.pathname.startsWith('/storage/v1/object/'))
        return { ok: false, error: `URL is not a valid storage path: ${u}` };
    } catch {
      return { ok: false, error: `Invalid URL: ${u}` };
    }
  }
  return { ok: true, list: urls as string[] };
}

/**
 * Extracts the storage object path from a Supabase Storage public URL.
 * URL format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 */
function extractStoragePath(url: string, bucket: string = 'media'): string | null {
  try {
    const parsed = new URL(url);
    const prefix = `/storage/v1/object/public/${bucket}/`;
    const idx = parsed.pathname.indexOf(prefix);
    if (idx === -1) return null;
    return parsed.pathname.slice(idx + prefix.length);
  } catch {
    return null;
  }
}

/**
 * Lists media from the library with search and filtering
 */
export const listLibrary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { search, type } = req.query;
    const userId = req.user?.id;
    const isSuper = req.user?.is_superadmin;
    const workspaceId = req.user?.workspace_id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!workspaceId && !isSuper) return res.status(403).json({ error: 'Workspace context missing' });

    // Step 1: Fetch only approved/available items — pending_review and blocked items
    // are intentionally hidden from the vault (reviewers handle them in Review Queue)
    let query = supabaseAdmin
      .from('media_library')
      .select('id, title, url, urls, file_type, uploader_id, status, created_at, workspace_id')
      .eq('status', 'available')
      .order('created_at', { ascending: false });

    if (!isSuper) {
      query = query.eq('workspace_id', workspaceId);
    }

    if (type && type !== 'all') {
      // Support both exact match ("image") and MIME type ("image/jpeg", "image/png")
      query = query.ilike('file_type', `${type}%`);
    }

    const { data: items, error } = await query;
    if (error) throw error;
    if (!items || items.length === 0) return res.status(200).json([]);

    // Step 2: Fetch uploader details for all unique uploader IDs
    const uploaderIds = [...new Set(items.map((i) => i.uploader_id).filter(Boolean))];
    const { data: uploaders } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .in('id', uploaderIds);

    const uploaderMap: Record<string, { id: string; full_name: string; email: string }> = {};
    (uploaders || []).forEach((u) => { uploaderMap[u.id] = u; });

    // Step 3: Merge and apply search filter
    let result = items.map((item) => ({
      ...item,
      urls: item.urls || [item.url],
      uploader: uploaderMap[item.uploader_id] || null,
    }));

    // Search by title OR uploader name
    if (search) {
      const q = (search as string).toLowerCase();
      result = result.filter((item) =>
        item.title?.toLowerCase().includes(q) ||
        item.uploader?.full_name?.toLowerCase().includes(q) ||
        item.uploader?.email?.toLowerCase().includes(q)
      );
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Registers a new asset in the library
 */

interface ScanResult {
  safe: boolean;
  isVideo: boolean;
  isAudio: boolean;
  needsReview?: boolean; // true = REQUEST_REVIEW (pending), false/undefined = BLOCK (rejected)
  reason?: string;
  violations?: string[];
  imageScanNotes: string[];
}

async function scanMediaUpload(
  title: string,
  urls: string[],
  file_type: string,
  workspaceId: string,
  mediaId: string,
): Promise<ScanResult> {
  const imageScanNotes: string[] = [];
  // When an image can't be auto-scanned, we fail CLOSED (route to human review)
  // rather than auto-approving — so sensitive content is never published unscanned.
  let imageScanUnavailable = false;
  const isAudioType = file_type.startsWith('audio/') || file_type === 'audio';
  const isVideoType = file_type.startsWith('video/') || file_type === 'video' || file_type === 'mixed';

  // ── Audio: AI transcription + text moderation (can pass, block, or review) ─
  if (isAudioType) {
    logger.info({ title, file_type }, '[LibraryScan] Audio upload — running Whisper transcription scan');
    imageScanNotes.push('[AUDIO] Running AI transcription + text moderation scan via Groq Whisper.');

    const primaryUrl = urls[0];
    const audioResult = await scanAudioVideo(primaryUrl, [], mediaId, workspaceId);
    imageScanNotes.push(...audioResult.notes);

    if (audioResult.skipped) {
      // Transcription unavailable — route to human reviewer
      imageScanNotes.push('[AUDIO] Transcription skipped — routing to Review Queue for human check.');
      return {
        safe: false,
        isVideo: false,
        isAudio: true,
        needsReview: true,
        reason: audioResult.reason || 'Audio transcription unavailable — routed for human review.',
        violations: ['audio_review_required'],
        imageScanNotes,
      };
    }

    if (audioResult.violations.length > 0) {
      const first = audioResult.violations[0];
      return {
        safe: false,
        isVideo: false,
        isAudio: true,
        needsReview: first.action === 'REQUEST_REVIEW',
        reason: first.description,
        violations: audioResult.violations.map(v => v.category),
        imageScanNotes,
      };
    }

    // Transcript is clean
    imageScanNotes.push('[AUDIO] Transcript passed all safety checks.');
    return { safe: true, isVideo: false, isAudio: true, imageScanNotes };
  }

  // ── Video: always route to human reviewer, never auto-block ──────────────
  if (isVideoType) {
    logger.info({ title, file_type }, '[LibraryScan] Video upload — routing to reviewer');
    return {
      safe: false,
      isVideo: true,
      isAudio: false,
      reason: 'Video content requires human review before publishing.',
      violations: ['video_review_required'],
      imageScanNotes: ['[VIDEO] Routed directly to Review Queue — video content is not auto-scanned.'],
    };
  }

  // ── Load keyword rules ────────────────────────────────────────────────────
  const { data: activeRules } = await supabaseAdmin
    .from('approval_rules')
    .select('id, rule_name, rule_status, keyword_rules')
    .eq('workspace_id', workspaceId)
    .in('rule_status', ['ACTIVE', 'ACTIVE_WITH_DRAFT_CHANGES', 'DRAFT']);

  const keywordRules: KeywordRule[] = [];
  for (const rule of (activeRules || [])) {
    const krs = rule.keyword_rules;
    if (!Array.isArray(krs)) continue;
    for (const kr of krs) {
      if (Array.isArray(kr.keywords) && kr.keywords.length > 0 && kr.action) {
        keywordRules.push({ id: rule.id, keywords: kr.keywords, action: kr.action });
      }
    }
  }

  // ── Title keyword check (fast path) ──────────────────────────────────────
  const lowerTitle = title.toLowerCase();
  for (const kr of keywordRules) {
    for (const kw of kr.keywords) {
      const lowerKw = kw.toLowerCase().trim();
      if (lowerKw && lowerTitle.includes(lowerKw)) {
        return {
          safe: false,
          isVideo: false,
          isAudio: false,
          reason: `Title contains ${kr.action === 'BLOCK' ? 'blocked' : 'review-required'} keyword: "${kw}"`,
          violations: ['blocked_word'],
          imageScanNotes: [`[TITLE] Keyword match: "${kw}" (action: ${kr.action})`],
        };
      }
    }
  }

  // ── Text moderation on title ──────────────────────────────────────────────
  const modResult = await moderate({ content: title, tenantId: workspaceId, workspaceId });
  const textViolations: string[] = [];
  const scores = modResult.categoryScores as Record<string, number>;
  for (const cat of ['offensive_language', 'sexual_content', 'violence', 'self_harm', 'hate_speech']) {
    if ((scores[cat] || 0) > 0.6) textViolations.push(cat);
  }
  if (textViolations.length > 0) {
    return {
      safe: false,
      isVideo: false,
      isAudio: false,
      reason: `Title failed safety check: ${textViolations.join(', ')}`,
      violations: textViolations,
      imageScanNotes: [`[TITLE] Safety categories triggered: ${textViolations.join(', ')}`],
    };
  }

  // ── Image scan — ALL urls ─────────────────────────────────────────────────
  if ((file_type.startsWith('image/') || file_type === 'image') && urls.length > 0) {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const label = urls.length > 1 ? `Image ${i + 1}/${urls.length}` : 'Image';
      logger.info({ url: url.slice(0, 80), label }, '[LibraryScan] Starting image scan');

      try {
        const imgResult = await scanImage(url, keywordRules, mediaId, workspaceId);

        if (imgResult.skipped) {
          imageScanUnavailable = true;
          imageScanNotes.push(`[${label}] Automated scan unavailable (no vision model or fetch failed) — routing to human review. URL: ${url.slice(0, 80)}`);
          continue;
        }

        // Build readable note for this image
        const textPreview = imgResult.extractedText
          ? `Extracted text: "${imgResult.extractedText.slice(0, 300)}"`
          : 'No text extracted from image.';
        const catSummary = Object.entries(imgResult.sensitiveCategories)
          .map(([k, v]) => `${k}=${(v as number * 100).toFixed(0)}%`)
          .join(', ') || 'none';
        const violSummary = imgResult.violations.length > 0
          ? imgResult.violations.map(v => `${v.action}:${v.category}(${v.matchedKeyword || v.description.slice(0, 50)})`).join('; ')
          : 'none';

        imageScanNotes.push(
          `[${label}] Model: ${imgResult.modelUsed || 'unknown'} | ${imgResult.durationMs}ms\n` +
          `  ${textPreview}\n` +
          `  Sensitive: ${catSummary}\n` +
          `  Violations: ${violSummary}`
        );

        // Check for violations — BLOCK outright rejects; REQUEST_REVIEW routes to human reviewer
        for (const v of imgResult.violations) {
          if (v.action === 'BLOCK') {
            return {
              safe: false,
              isVideo: false,
              isAudio: false,
              needsReview: false,
              reason: `${label}: ${v.description}`,
              violations: [v.category],
              imageScanNotes,
            };
          }
          if (v.action === 'REQUEST_REVIEW') {
            return {
              safe: false,
              isVideo: false,
              isAudio: false,
              needsReview: true,
              reason: `${label} flagged for review: ${v.description}`,
              violations: [v.category],
              imageScanNotes,
            };
          }
        }
      } catch (err) {
        imageScanUnavailable = true;
        logger.error({ err, url }, '[LibraryScan] scanImage threw unexpectedly');
        imageScanNotes.push(`[${label}] Scan error — routing to human review: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Fail closed: if any image could not be scanned, send it for human review
  // instead of auto-approving it into the library.
  if (imageScanUnavailable) {
    return {
      safe: false,
      isVideo: false,
      isAudio: false,
      needsReview: true,
      reason: 'Automated image safety scan was unavailable — routed to human review.',
      violations: ['image_scan_unavailable'],
      imageScanNotes,
    };
  }

  return { safe: true, isVideo: false, isAudio: false, imageScanNotes };
}

/**
 * Registers a new asset in the library
 */
/**
 * Sniffs the leading bytes of a file to detect a genuine image format.
 * Returns the format name, or null if the bytes are not a recognized image
 * (i.e. corrupted, empty, or a non-image renamed with an image extension).
 */
function sniffImageFormat(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)) return 'tiff';
  if (/^ftyp(heic|heif|heix|hevc|mif1|avif|avis)/.test(buf.toString('ascii', 4, 12))) return 'heif';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 512)).trim().toLowerCase();
  if (head.includes('<svg') || (head.startsWith('<?xml') && head.includes('svg'))) return 'svg';
  return null;
}

/**
 * Verifies a storage URL points to a genuine, decodable image by sniffing its
 * magic bytes. Fails OPEN on network errors so a transient fetch failure never
 * blocks a legitimate upload.
 */
async function isDecodableImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    if (!res.ok && res.status !== 206) {
      logger.warn({ url, status: res.status }, '[LibraryValidate] Could not fetch file for image validation — allowing');
      return true; // fail open
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return false; // empty file is invalid
    return sniffImageFormat(buf) !== null;
  } catch (e) {
    logger.warn({ url, err: (e as Error).message }, '[LibraryValidate] Image validation fetch error — allowing');
    return true; // fail open on network error
  }
}

export const addToLibrary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, urls, file_type } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    if (!title || !urls || !file_type) {
      return res.status(400).json({ error: 'Missing required fields: title, urls, file_type' });
    }

    // Validate every URL belongs to this Supabase project and is a storage path
    const urlCheck = validateStorageUrls(urls);
    if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });
    const validatedUrls = urlCheck.list;

    const workspaceId = req.user?.workspace_id;
    if (!workspaceId) return res.status(403).json({ error: 'Workspace context missing' });

    // Reject corrupted / non-image files before they ever enter the library.
    // The client claims file_type; verify the actual bytes are a real image.
    if (file_type && (String(file_type).startsWith('image/') || file_type === 'image')) {
      for (const url of validatedUrls) {
        const ok = await isDecodableImage(url);
        if (!ok) {
          return res.status(400).json({
            error: 'This file is not a valid image — it appears corrupted or is not an image file. It was not added to the library.',
          });
        }
      }
    }

    const mediaId = uuidv4();

    // Run the safety scan (pass mediaId so logs are linked)
    const scan = await scanMediaUpload(title, validatedUrls, file_type, workspaceId, mediaId);

    // Determine library status:
    //   available     → scan passed
    //   pending_review → video OR REQUEST_REVIEW violation (drugs/alcohol/graphic — needs human sign-off)
    //   blocked        → BLOCK violation (explicit nudity, gore, hate symbols, self-harm)
    const libraryStatus = scan.safe
      ? 'available'
      : (scan.isVideo || scan.needsReview)
        ? 'pending_review'
        : 'blocked';

    const { file_size_bytes } = req.body;

    const { data: mediaAsset, error } = await supabaseAdmin
      .from('media_library')
      .insert({
        id: mediaId,
        title,
        urls: validatedUrls,
        url: validatedUrls[0],
        file_type,
        uploader_id: userId,
        workspace_id: workspaceId,
        status: libraryStatus,
        ...(file_size_bytes != null ? { file_size_bytes } : {}),
      })
      .select()
      .single();

    if (error) throw error;

    // Track storage usage — use real size when available, fall back to rough estimate
    if (mediaAsset && workspaceId) {
      const actualMb = file_size_bytes ? file_size_bytes / (1024 * 1024) : urls.length * 0.5;
      trackUsage({ workspaceId, resourceType: 'STORAGE_MB', quantity: actualMb, costUsd: 0, unit: 'MB', referenceId: mediaId, referenceType: 'media_upload', metadata: { file_type, url_count: urls.length } });
    }

    // Determine validation status
    const validationStatus = scan.safe
      ? 'PASSED'
      : scan.isVideo
        ? 'MANUAL_CHECK_REQUIRED'
        : 'MANUAL_CHECK_REQUIRED';

    // Create a validation item in Validation Desk
    const validationItemId = uuidv4();
    await supabaseAdmin
      .from('validation_items')
      .insert({
        id: validationItemId,
        tenant_id: workspaceId,
        workspace_id: workspaceId,
        source_module: 'media_library',
        source_entity_id: mediaId,
        item_type: 'campaign_asset',
        title: title,
        content_snapshot: { copy: title, urls, file_type },
        validation_status: validationStatus,
        risk_level: scan.safe ? 'LOW' : 'HIGH',
        submitted_by: userId,
        due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      });

    // Always write a scan note so the Validation Desk shows what Gemini found
    const scanNoteBody = scan.imageScanNotes.length > 0
      ? `🤖 Automated Scan Report:\n\n${scan.imageScanNotes.join('\n\n')}`
      : '🤖 Automated Scan: No images scanned (title-only check passed).';

    try {
      await supabaseAdmin
        .from('validation_notes')
        .insert({ id: uuidv4(), validation_item_id: validationItemId, note_body: scanNoteBody, created_by: 'system' });
    } catch { /* non-blocking */ }

    // If not safe — each governance side-effect runs in its own try-catch so a failure
    // in one step never prevents the others from executing.
    if (!scan.safe) {
      const reviewTitle = scan.isVideo
        ? `[VIDEO REVIEW] ${title}`
        : scan.isAudio && scan.needsReview
          ? `[AUDIO REVIEW] ${title}`
          : scan.needsReview
            ? `[NEEDS REVIEW] ${title}`
            : `[BLOCKED] ${title}`;

      // ── 1. Review Queue (most critical for UX — runs first, isolated) ────────
      try {
        await supabaseAdmin.from('review_items').insert({
          id: uuidv4(),
          tenant_id: workspaceId,
          workspace_id: workspaceId,
          item_type: 'campaign_asset',
          source_module: 'media_library',
          source_entity_id: mediaId,
          title: reviewTitle,
          content_snapshot: { title, urls: validatedUrls, file_type, reason: scan.reason },
          submitted_by: userId,
          priority: (scan.isVideo || (scan.isAudio && scan.needsReview)) ? 'NORMAL' : 'HIGH',
          risk_level: scan.needsReview ? 'MEDIUM' : 'HIGH',
          status: 'PENDING_REVIEW',
          submitted_at: new Date().toISOString(),
        });
        logger.info({ mediaId, title }, '[Library] review_items entry created');
      } catch (reviewErr) {
        logger.warn({ err: reviewErr, mediaId, title }, '[Library] Failed to create review_items entry');
      }

      // ── 2. Validation run trail ───────────────────────────────────────────────
      try {
        const runId = uuidv4();
        await supabaseAdmin.from('validation_runs').insert({
          id: runId,
          validation_item_id: validationItemId,
          run_by: userId,
          run_status: 'COMPLETED',
          result_summary: scan.isVideo ? 'Video routed to human reviewer' : scan.isAudio && scan.needsReview ? 'Audio routed to human reviewer' : 'Blocked on upload safety scan',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        await supabaseAdmin.from('validation_rule_results').insert({
          id: uuidv4(),
          validation_run_id: runId,
          rule_name: scan.isVideo ? 'Video Review Policy' : scan.isAudio ? 'Audio AI Safety Scan' : 'Automated Media Safety Scan',
          rule_category: 'policy_rules',
          result: (scan.isVideo || (scan.isAudio && scan.needsReview)) ? 'FAILED' : 'BLOCKED',
          severity: 'HIGH',
          explanation: scan.reason || 'Content requires review.',
          override_eligible: scan.isVideo || (scan.isAudio && !!scan.needsReview),
          manual_check_required: true,
        });
      } catch (runErr) {
        logger.warn({ err: runErr, mediaId }, '[Library] Validation run trail failed (non-blocking)');
      }

      // ── 3. Approval Console ───────────────────────────────────────────────────
      try {
        await createApprovalItem({
          tenant_id: workspaceId,
          workspace_id: workspaceId,
          item_type: 'CONTENT_APPROVAL',
          source_module: 'media_library',
          source_entity_id: mediaId,
          title: reviewTitle,
          submitted_by: userId,
          risk_level: scan.needsReview ? 'MEDIUM' : 'HIGH',
        });
      } catch (approvalErr) {
        logger.warn({ err: approvalErr, mediaId }, '[Library] Approval item creation failed (non-blocking)');
      }

      // ── 4. Notify creator ─────────────────────────────────────────────────────
      try {
        const notifTitle = scan.isVideo
          ? '📹 Video Sent for Review'
          : scan.isAudio && scan.needsReview
            ? '🎵 Audio Sent for Review'
            : scan.needsReview
              ? '🔍 Media Flagged for Review'
              : '🚫 Media Blocked';
        const notifBody = scan.isVideo
          ? `Your video "${title}" has been sent to the Review Queue. A reviewer will approve or reject it before it can be published.`
          : scan.isAudio && scan.needsReview
            ? `Your audio file "${title}" was sent to the Review Queue: ${scan.reason}. A reviewer will check it before it appears in the library.`
            : scan.needsReview
              ? `Your media "${title}" was flagged for review: ${scan.reason}. A reviewer will check it before it appears in the library.`
              : `Your media "${title}" was blocked: ${scan.reason}. It violates content policy and cannot be published.`;
        await supabaseAdmin.from('notifications').insert({
          id: uuidv4(),
          user_id: userId,
          title: notifTitle,
          body: notifBody,
          type: 'GOVERNANCE',
          link: '/queue',
          read: false,
        });
      } catch (notifErr) {
        logger.warn({ err: notifErr, mediaId }, '[Library] Notification failed (non-blocking)');
      }

      // ── 5. Audit event ────────────────────────────────────────────────────────
      try {
        await createAuditEvent({
          workspace_id: workspaceId,
          tenant_id: workspaceId,
          event_category: 'content_lifecycle',
          event_type: scan.isVideo ? 'media.video_pending_review' : scan.isAudio && scan.needsReview ? 'media.audio_pending_review' : 'media.safety_violation',
          event_title: scan.isVideo ? `Video Upload Pending Review: ${title}` : scan.isAudio && scan.needsReview ? `Audio Upload Pending Review: ${title}` : `Media Safety Violation: ${title}`,
          event_summary: scan.reason || 'Content flagged by automated safety scanner and routed to review queue.',
          actor: { actor_id: userId, actor_type: 'human' },
          object: { object_type: 'media_asset', object_id: mediaId },
          risk_level: (scan.isVideo || (scan.isAudio && scan.needsReview)) ? 'medium' : 'high',
          status: (scan.isVideo || (scan.isAudio && scan.needsReview)) ? 'pending' : 'blocked',
          evidence_state: 'not_preserved',
          retention_class: 'STANDARD',
        } as any);
      } catch { /* non-blocking */ }
    }

    logger.info({
      title,
      userId,
      mediaId,
      status: libraryStatus,
      isVideo: scan.isVideo,
      isAudio: scan.isAudio,
      safe: scan.safe,
      reason: scan.reason,
    }, '[Library] Asset processed');

    res.status(201).json(mediaAsset);
  } catch (error) {
    next(error);
  }
};

/**
 * Deletes an asset from the library and its files from storage permanently.
 */
export const deleteFromLibrary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId      = req.user?.id;
    const workspaceId = req.user?.workspace_id;
    const role        = req.user?.role;
    const isSuper     = req.user?.is_superadmin;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!workspaceId && !isSuper) return res.status(403).json({ error: 'Workspace context missing' });

    const isAdmin = ['ADMIN', 'MANAGER', 'WORKSPACE_OWNER'].includes(role ?? '');

    // Fetch item details (including name/type) before deleting for evidence trail
    let fetchQuery = supabaseAdmin
      .from('media_library')
      .select('url, urls, name, type, file_size_bytes, mime_type, uploader_id, created_at')
      .eq('id', id);

    if (!isSuper) {
      fetchQuery = fetchQuery.eq('workspace_id', workspaceId);
    }

    const { data: item } = await fetchQuery.single();
    if (item) {
      const paths = [item.url, ...(item.urls || [])]
        .filter(Boolean)
        .map((u: string) => extractStoragePath(u))
        .filter(Boolean) as string[];
      if (paths.length > 0) {
        await supabaseAdmin.storage.from('media').remove(paths);
      }
    }

    let query = supabaseAdmin
      .from('media_library')
      .delete()
      .eq('id', id);

    if (!isSuper) {
      query = query.eq('workspace_id', workspaceId);
      if (!isAdmin) {
        query = query.eq('uploader_id', userId);
      }
    }

    const { error } = await query;
    if (error) throw error;

    // Preserve evidence of deletion in Evidence Vault (fire-and-forget)
    if (workspaceId) {
      const crossUserDeletion = item?.uploader_id && item.uploader_id !== userId;
      const deletedAt = new Date().toISOString();
      const payload = JSON.stringify({
        action: 'media_deleted',
        asset_id: id,
        asset_name: item?.name || id,
        asset_type: item?.type || 'unknown',
        mime_type: item?.mime_type || null,
        file_size_bytes: item?.file_size_bytes || 0,
        uploader_id: item?.uploader_id || null,
        original_upload_at: item?.created_at || null,
        deleted_by: userId,
        deleted_by_role: role,
        deleted_at: deletedAt,
        cross_user_deletion: crossUserDeletion,
      });
      preserveEvidence({
        workspace_id: workspaceId,
        tenant_id: workspaceId,
        source_type: 'file',
        source_id: String(id),
        source_system: 'media_vault',
        evidence_type: 'asset_deletion',
        risk_level: crossUserDeletion ? 'high' : 'medium',
        sensitivity: 'internal',
        preservation_reason: crossUserDeletion
          ? `Media asset deleted by ${role} (${userId}) — originally uploaded by a different user`
          : 'Media asset permanently deleted from library',
        preserved_by: userId,
        payload,
        payload_size: payload.length,
        mime_type: 'application/json',
        retention_class: 'standard',
        metadata: {
          asset_id: id,
          asset_name: item?.name || id,
          asset_type: item?.type || 'unknown',
          uploader_id: item?.uploader_id || null,
          deleted_by: userId,
          deleted_by_role: role,
          cross_user_deletion: crossUserDeletion,
        },
      }).catch((err) => {
        console.error('[Evidence] preserveEvidence failed for media deletion:', err?.message);
      });

      createAuditEvent({
        workspace_id: workspaceId,
        event_category: 'content_lifecycle',
        event_type: 'content.deleted',
        event_title: 'Media Asset Deleted',
        event_summary: `Media asset "${item?.name || String(id)}" deleted from library${crossUserDeletion ? ` (deleted by ${role}, originally uploaded by another user)` : ''}`,
        actor: { actor_id: userId, actor_type: 'human_user' },
        object: { object_type: 'media_asset', object_id: String(id) },
        risk_level: crossUserDeletion ? 'high' : 'medium',
        status: 'success',
        evidence_state: 'preserved',
        retention_class: 'STANDARD',
        correlation: {},
        change: {
          field_changed: 'vault_state',
          previous_value: 'active',
          new_value: 'deleted',
          change_reason: crossUserDeletion
            ? `Deleted by ${role} (${userId}), originally uploaded by ${item?.uploader_id}`
            : `Deleted by ${role}`,
        },
      }).catch((err) => {
        console.error('[Audit] createAuditEvent failed for media deletion:', err?.message);
      });
    }

    // Clean up resource_usage so the Storage meter reflects the deletion (fire-and-forget)
    supabaseAdmin.from('resource_usage')
      .delete()
      .eq('workspace_id', workspaceId ?? '')
      .eq('resource_type', 'STORAGE_MB')
      .contains('metadata', { reference_id: id })
      .then(undefined, () => {});

    res.status(200).json({ success: true, message: 'Asset removed from library' });
  } catch (error) {
    next(error);
  }
};

/**
 * Lists ALL media items for the workspace — used by Manage Storage.
 * No status filter: shows available, pending_review, and blocked items.
 * Never crosses workspace boundaries.
 * Lazy-backfills file_size_bytes from Supabase Storage for items that don't have it yet.
 */
export const listStorageItems = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId      = req.user?.id;
    const workspaceId = req.user?.workspace_id;
    if (!userId)      return res.status(401).json({ error: 'Unauthorized' });
    if (!workspaceId) return res.status(403).json({ error: 'Workspace context missing' });

    const { search, type } = req.query;

    let query = supabaseAdmin
      .from('media_library')
      .select('id, title, url, urls, file_type, uploader_id, status, created_at, workspace_id, file_size_bytes')
      .eq('workspace_id', workspaceId)   // always workspace-scoped, no cross-workspace leakage
      .order('created_at', { ascending: false });  // no status filter — show all for management

    if (type && type !== 'all') {
      query = query.ilike('file_type', `${type}%`);
    }

    const { data: items, error } = await query;
    if (error) throw error;
    if (!items || items.length === 0) return res.status(200).json({ success: true, data: [] });

    const uploaderIds = [...new Set(items.map((i: any) => i.uploader_id).filter(Boolean))];
    const { data: uploaders } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .in('id', uploaderIds);

    const uploaderMap: Record<string, { id: string; full_name: string; email: string }> = {};
    ((uploaders as any[]) || []).forEach((u: any) => { uploaderMap[u.id] = u; });

    const result = (items as any[]).map((item: any) => ({
      id:              item.id,
      title:           item.title,
      url:             item.url,
      urls:            item.urls || [item.url],
      file_type:       item.file_type,
      status:          item.status,
      created_at:      item.created_at,
      file_size_bytes: item.file_size_bytes as number | null,
      uploader:        uploaderMap[item.uploader_id] || null,
    }));

    // Lazy-backfill: for items with no stored size, fetch from Supabase Storage metadata.
    // Updates the response in-place AND saves to DB so subsequent requests skip this step.
    const noSize = result.filter(r => r.file_size_bytes == null && r.url);
    if (noSize.length > 0) {
      const dbUpdates: { id: string; size: number }[] = [];

      await Promise.all(noSize.map(async (item) => {
        const storagePath = extractStoragePath(item.url);
        if (!storagePath) return;

        const lastSlash = storagePath.lastIndexOf('/');
        const folder    = lastSlash >= 0 ? storagePath.slice(0, lastSlash) : '';
        const filename  = lastSlash >= 0 ? storagePath.slice(lastSlash + 1) : storagePath;

        try {
          const { data: files } = await supabaseAdmin.storage
            .from('media')
            .list(folder, { search: filename, limit: 1 });

          const meta = (files as any[])?.[0]?.metadata;
          const size: number | undefined = meta?.size ?? meta?.contentLength;
          if (size && size > 0) {
            item.file_size_bytes = size;
            dbUpdates.push({ id: item.id, size });
          }
        } catch {
          // ignore — storage fetch failure is non-fatal
        }
      }));

      // Fire-and-forget DB update so the next request reads sizes from the DB directly
      for (const { id, size } of dbUpdates) {
        supabaseAdmin.from('media_library')
          .update({ file_size_bytes: size })
          .eq('id', id)
          .then(undefined, () => {});
      }
    }

    let filtered = result;
    if (search) {
      const q = (search as string).toLowerCase();
      filtered = result.filter((item) =>
        item.title?.toLowerCase().includes(q) ||
        item.uploader?.full_name?.toLowerCase().includes(q) ||
        item.uploader?.email?.toLowerCase().includes(q),
      );
    }

    res.status(200).json({ success: true, data: filtered, total: filtered.length });
  } catch (error) {
    next(error);
  }
};

export const bulkDeleteFromLibrary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId      = req.user?.id;
    const workspaceId = req.user?.workspace_id;
    const role        = req.user?.role;
    const isSuper     = req.user?.is_superadmin;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!workspaceId && !isSuper) return res.status(403).json({ error: 'Workspace context missing' });

    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids array is required' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ success: false, error: 'Cannot delete more than 500 items at once' });
    }

    const isAdmin = ['ADMIN', 'MANAGER', 'WORKSPACE_OWNER'].includes(role ?? '');

    // Fetch items to get storage paths before deleting
    let fetchQuery = supabaseAdmin
      .from('media_library')
      .select('id, url, urls')
      .in('id', ids);

    if (!isSuper) {
      fetchQuery = fetchQuery.eq('workspace_id', workspaceId);
      if (!isAdmin) {
        fetchQuery = fetchQuery.eq('uploader_id', userId);
      }
    }

    const { data: items } = await fetchQuery;

    // Delete files from Supabase Storage first
    if (items?.length) {
      const paths: string[] = [];
      for (const item of items) {
        const urlsToCheck = [item.url, ...(item.urls || [])].filter(Boolean);
        for (const url of urlsToCheck) {
          const p = extractStoragePath(url);
          if (p) paths.push(p);
        }
      }
      if (paths.length > 0) {
        const { error: storageErr } = await supabaseAdmin.storage.from('media').remove(paths);
        if (storageErr) {
          logger.warn({ storageErr, paths }, '[Library] Failed to remove some storage files');
        }
      }
    }

    let delQuery = supabaseAdmin
      .from('media_library')
      .delete()
      .in('id', ids);

    if (!isSuper) {
      delQuery = delQuery.eq('workspace_id', workspaceId);
      if (!isAdmin) {
        delQuery = delQuery.eq('uploader_id', userId);
      }
    }

    // .select() forces PostgREST to return deleted rows so we can verify the actual count.
    const { data: deleted, error } = await (delQuery as any).select('id');
    if (error) throw error;

    const actualCount = (deleted as any[])?.length ?? 0;
    if (actualCount === 0) {
      logger.warn({ userId, workspaceId, requestedIds: ids }, '[Library] Bulk delete matched 0 rows');
      return res.status(404).json({ success: false, error: 'No items were deleted. They may already be deleted or not belong to your workspace.' });
    }

    logger.info({ userId, workspaceId, count: actualCount }, '[Library] Bulk delete');

    // Clean up resource_usage entries for each deleted item so storage meter resets (fire-and-forget)
    const deletedIds = (deleted as any[]).map((r: any) => r.id);
    for (const mediaId of deletedIds) {
      supabaseAdmin.from('resource_usage')
        .delete()
        .eq('workspace_id', workspaceId ?? '')
        .eq('resource_type', 'STORAGE_MB')
        .contains('metadata', { reference_id: mediaId })
        .then(undefined, () => {});
    }

    res.status(200).json({ success: true, deleted: actualCount });
  } catch (error) {
    next(error);
  }
};

/**
 * Scan a single already-uploaded image URL for content policy violations.
 * Used by the publishing hub after direct Supabase storage uploads so that
 * images are scanned before being submitted to governance/scheduler.
 *
 * POST /api/v1/media/scan
 * Body: { url: string }
 * Response: { safe: boolean, status: 'available' | 'pending_review' | 'blocked', reason?: string, skipped?: boolean }
 */
export const scanMediaUrl = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body as { url?: string };
    const userId      = req.user?.id;
    const workspaceId = req.user?.workspace_id;

    if (!userId)      return res.status(401).json({ error: 'Unauthorized' });
    if (!workspaceId) return res.status(403).json({ error: 'Workspace context missing' });
    if (!url)         return res.status(400).json({ error: 'url is required' });

    // Validate URL belongs to this Supabase project
    const urlCheck = validateStorageUrls([url]);
    if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });
    const checkedUrl = urlCheck.list[0];

    // Videos: skip scan, route to review
    const isVideoUrl = /\.(mp4|mov|webm|ogg|avi|mkv)(\?|$)/i.test(checkedUrl);
    if (isVideoUrl) {
      return res.status(200).json({ safe: false, status: 'pending_review', reason: 'Video content requires human review before publishing.' });
    }

    // Load workspace keyword rules
    const { data: activeRules } = await supabaseAdmin
      .from('approval_rules')
      .select('id, rule_name, rule_status, keyword_rules')
      .eq('workspace_id', workspaceId)
      .in('rule_status', ['ACTIVE', 'ACTIVE_WITH_DRAFT_CHANGES', 'DRAFT']);

    const keywordRules: KeywordRule[] = [];
    for (const rule of (activeRules || [])) {
      const krs = rule.keyword_rules;
      if (!Array.isArray(krs)) continue;
      for (const kr of krs) {
        if (Array.isArray(kr.keywords) && kr.keywords.length > 0 && kr.action) {
          keywordRules.push({ id: rule.id, keywords: kr.keywords, action: kr.action });
        }
      }
    }

    // Run AI image scan
    const result = await scanImage(checkedUrl, keywordRules, undefined, workspaceId);

    if (result.skipped) {
      return res.status(200).json({ safe: true, status: 'available', skipped: true });
    }

    for (const v of result.violations) {
      if (v.action === 'BLOCK') {
        return res.status(200).json({ safe: false, status: 'blocked', reason: v.description });
      }
      if (v.action === 'REQUEST_REVIEW') {
        return res.status(200).json({ safe: false, status: 'pending_review', reason: v.description });
      }
    }

    return res.status(200).json({ safe: true, status: 'available' });
  } catch (error) {
    next(error);
  }
};
