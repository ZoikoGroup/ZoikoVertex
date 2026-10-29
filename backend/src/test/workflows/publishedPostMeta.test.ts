import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock supabaseAdmin (must use vi.hoisted since vi.mock is hoisted to top) ─

const { mockSupabase, mockQueryBuilder } = vi.hoisted(() => {
  const qb: any = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const key of Object.keys(qb)) {
    qb[key].mockReturnValue(qb);
  }
  const sb = { from: vi.fn(() => qb) };
  return { mockSupabase: sb, mockQueryBuilder: qb };
});

vi.mock('../../shared/supabase', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  extractPlatformCaption,
  normalizeMetaPost,
  fetchMetaPost,
  findMetaPostByCaption,
  getPublishedPostMeta,
} from '../../services/publishedPostMeta.service';

// ─── fetch mock helpers ──────────────────────────────────────────────────────

const fetchMock = vi.fn();

function respondWith(...bodies: unknown[]) {
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({ json: async () => body });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockQueryBuilder)) {
    mockQueryBuilder[key].mockReturnValue(mockQueryBuilder);
  }
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── extractPlatformCaption ──────────────────────────────────────────────────

describe('extractPlatformCaption', () => {
  it('returns plain-text content as is', () => {
    expect(extractPlatformCaption('Hello world', 'threads')).toBe('Hello world');
  });

  it('picks the caption for the platform from JSON content', () => {
    const content = JSON.stringify({ instagram: 'IG caption', threads: 'Threads caption' });
    expect(extractPlatformCaption(content, 'threads')).toBe('Threads caption');
  });

  it('falls back to the first caption when the platform key is missing', () => {
    const content = JSON.stringify({ instagram: 'IG caption' });
    expect(extractPlatformCaption(content, 'facebook')).toBe('IG caption');
  });

  it('returns empty string for empty content', () => {
    expect(extractPlatformCaption(null, 'threads')).toBe('');
  });
});

// ─── normalizeMetaPost / fetchMetaPost ───────────────────────────────────────

describe('normalizeMetaPost', () => {
  it('keeps Threads fields and maps carousel children', () => {
    const meta = normalizeMetaPost('threads', {
      id: '179',
      text: 'Excited!',
      timestamp: '2026-10-27T12:00:00+0000',
      media_type: 'CAROUSEL_ALBUM',
      permalink: 'https://www.threads.net/@zoikovertex/post/abc',
      username: 'zoikovertex',
      children: { data: [{ id: '1', media_type: 'IMAGE', media_url: 'https://cdn/1.jpg' }] },
    });
    expect(meta).toMatchObject({
      id: '179',
      text: 'Excited!',
      media_type: 'CAROUSEL_ALBUM',
      permalink: 'https://www.threads.net/@zoikovertex/post/abc',
      username: 'zoikovertex',
    });
    expect(meta.children).toEqual([{ media_type: 'IMAGE', media_url: 'https://cdn/1.jpg', thumbnail_url: null }]);
  });

  it('maps Instagram caption to text and reels to REELS', () => {
    const meta = normalizeMetaPost('instagram', {
      id: '9', caption: 'IG post', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://instagram.com/p/x',
    });
    expect(meta.text).toBe('IG post');
    expect(meta.media_type).toBe('REELS');
  });

  it('maps Facebook post fields', () => {
    const meta = normalizeMetaPost('facebook', {
      id: '1_2', message: 'FB post', created_time: '2026-10-27T12:00:00+0000',
      full_picture: 'https://cdn/fb.jpg', permalink_url: 'https://www.facebook.com/1/posts/2',
    });
    expect(meta).toMatchObject({
      text: 'FB post', timestamp: '2026-10-27T12:00:00+0000', media_type: 'IMAGE',
      media_url: 'https://cdn/fb.jpg', permalink: 'https://www.facebook.com/1/posts/2',
    });
  });

  it('maps Facebook video fields and makes the permalink absolute', () => {
    const meta = normalizeMetaPost('facebook', {
      id: '55', description: 'FB video', source: 'https://cdn/v.mp4', picture: 'https://cdn/v.jpg', permalink_url: '/page/videos/55/',
    }, 'video');
    expect(meta).toMatchObject({
      media_type: 'VIDEO', media_url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/v.jpg',
      permalink: 'https://www.facebook.com/page/videos/55/',
    });
  });
});

describe('fetchMetaPost', () => {
  it('maps Meta OAuth error 190 to token_expired', async () => {
    respondWith({ error: { message: 'Session has expired', code: 190 } });
    const result = await fetchMetaPost('threads', '179', 'tok');
    expect(result).toEqual({ meta: null, raw: null, error: 'token_expired' });
  });

  it('returns other Meta errors as their message', async () => {
    respondWith({ error: { message: 'Unsupported get request', code: 100 } });
    const result = await fetchMetaPost('instagram', '9', 'tok');
    expect(result.error).toBe('Unsupported get request');
  });

  it('returns the normalised post and the raw body', async () => {
    const raw = { id: '179', text: 'Hi', permalink: 'https://www.threads.net/@z/post/a' };
    respondWith(raw);
    const result = await fetchMetaPost('threads', '179', 'tok');
    expect(result.error).toBeNull();
    expect(result.raw).toEqual(raw);
    expect(result.meta?.permalink).toBe('https://www.threads.net/@z/post/a');
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://graph.threads.net/v1.0/179?');
  });
});

// ─── findMetaPostByCaption ───────────────────────────────────────────────────

describe('findMetaPostByCaption', () => {
  const account = { account_handle: 'user-1', access_token: 'tok' };
  const createdAt = '2026-10-20T10:00:00.000Z';

  it('matches ignoring whitespace differences', async () => {
    respondWith({
      data: [
        { id: 'a', text: 'Other post', timestamp: '2026-10-20T11:00:00+0000' },
        { id: 'b', text: '  Big   news\ntoday ', timestamp: '2026-10-20T12:00:00+0000' },
      ],
    });
    const result = await findMetaPostByCaption('threads', account, 'Big news today', createdAt);
    expect(result).toEqual({ id: 'b', error: null });
  });

  it('returns null id when nothing matches', async () => {
    respondWith({ data: [{ id: 'a', text: 'Other post', timestamp: '2026-10-20T11:00:00+0000' }] });
    const result = await findMetaPostByCaption('threads', account, 'Big news today', createdAt);
    expect(result).toEqual({ id: null, error: null });
  });

  it('prefers the earliest match at or after created_at', async () => {
    respondWith({
      data: [
        { id: 'late', text: 'Same caption', timestamp: '2026-10-22T10:00:00+0000' },
        { id: 'before', text: 'Same caption', timestamp: '2026-10-20T09:30:00+0000' },
        { id: 'first', text: 'Same caption', timestamp: '2026-10-20T10:05:00+0000' },
      ],
    });
    const result = await findMetaPostByCaption('threads', account, 'Same caption', createdAt);
    expect(result.id).toBe('first');
  });

  it('follows paging.next and stops after 3 pages', async () => {
    const page = (n: number) => ({ data: [{ id: `p${n}`, text: 'nope' }], paging: { next: `https://graph.threads.net/next/${n}` } });
    respondWith(page(1), page(2), page(3), page(4));
    const result = await findMetaPostByCaption('threads', account, 'Big news today', createdAt);
    expect(result.id).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.threads.net/next/1');
  });

  it('surfaces token errors from the listing call', async () => {
    respondWith({ error: { message: 'expired', code: 190 } });
    const result = await findMetaPostByCaption('instagram', account, 'Big news today', createdAt);
    expect(result).toEqual({ id: null, error: 'token_expired' });
  });
});

// ─── getPublishedPostMeta ────────────────────────────────────────────────────

describe('getPublishedPostMeta', () => {
  it('returns null for an intent outside the workspace', async () => {
    mockQueryBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await getPublishedPostMeta('ws-1', 'intent-from-ws-2');
    expect(result).toBeNull();
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith('workspace_id', 'ws-1');
  });

  it('returns not_published without calling Meta', async () => {
    mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: 'i1', platform: 'threads', status: 'PENDING_REVIEW', target_account_ids: ['a1'] },
      error: null,
    });
    const result = await getPublishedPostMeta('ws-1', 'i1');
    expect(result).toEqual({ status: 'not_published', platform: 'threads', posts: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up APPROVED posts too, since they can be live without a PUBLISHED status', async () => {
    mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'i1', platform: 'instagram', status: 'APPROVED', content: 'i am having a lovely day',
        created_at: '2026-10-28T10:38:00Z', target_account_ids: ['a1'],
      },
      error: null,
    });
    mockQueryBuilder.eq
      .mockReturnValueOnce(mockQueryBuilder)
      .mockReturnValueOnce(mockQueryBuilder)
      .mockResolvedValueOnce({
        data: [{ id: 'a1', platform: 'instagram', account_handle: 'ig1', account_name: 'zoiko', access_token: 'tok' }],
        error: null,
      })
      .mockReturnValueOnce(mockQueryBuilder)
      .mockResolvedValueOnce({ error: null });
    respondWith(
      { data: [{ id: '777', caption: 'i am having a lovely day', timestamp: '2026-10-28T10:39:00+0000' }] },
      { id: '777', caption: 'i am having a lovely day', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/abc/' },
    );

    const result = await getPublishedPostMeta('ws-1', 'i1');
    expect(result?.status).toBe('ok');
    expect(result?.posts[0]).toMatchObject({ post_id: '777', matched: true, error: null });
    expect(result?.posts[0].meta?.permalink).toBe('https://www.instagram.com/p/abc/');
  });

  it('returns unsupported_platform for non-Meta posts without calling Meta', async () => {
    mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
      data: { id: 'i1', platform: 'linkedin', status: 'PUBLISHED', target_account_ids: ['a1'] },
      error: null,
    });
    const result = await getPublishedPostMeta('ws-1', 'i1');
    expect(result?.status).toBe('unsupported_platform');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the stored platform post id and fetches it from Meta', async () => {
    mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'i1', platform: 'threads', status: 'PUBLISHED', content: 'Hi', created_at: '2026-10-20T10:00:00Z',
        target_account_ids: ['a1'], platform_post_id: null,
        platform_posts: [{ platform: 'threads', account_id: 'a1', post_id: '179' }],
      },
      error: null,
    });
    // connected_accounts query resolves at .eq('workspace_id') — second eq call in the chain
    mockQueryBuilder.eq
      .mockReturnValueOnce(mockQueryBuilder) // publish_intents .eq('id')
      .mockReturnValueOnce(mockQueryBuilder) // publish_intents .eq('workspace_id')
      .mockResolvedValueOnce({
        data: [{ id: 'a1', platform: 'threads', account_handle: 'u1', account_name: 'zoikovertex', access_token: 'tok' }],
        error: null,
      });
    respondWith({ id: '179', text: 'Hi', permalink: 'https://www.threads.net/@zoikovertex/post/a' });

    const result = await getPublishedPostMeta('ws-1', 'i1');
    expect(result?.status).toBe('ok');
    expect(result?.posts[0]).toMatchObject({
      platform: 'threads', account_id: 'a1', account_name: 'zoikovertex', post_id: '179', matched: false, error: null,
    });
    expect(result?.posts[0].meta?.permalink).toBe('https://www.threads.net/@zoikovertex/post/a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockQueryBuilder.update).not.toHaveBeenCalled();
  });

  it('backfills by caption match and saves the found id', async () => {
    mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'i1', platform: 'threads', status: 'PUBLISHED', content: 'Big news', created_at: '2026-10-20T10:00:00Z',
        target_account_ids: ['a1'], platform_post_id: null, platform_posts: [],
      },
      error: null,
    });
    mockQueryBuilder.eq
      .mockReturnValueOnce(mockQueryBuilder)
      .mockReturnValueOnce(mockQueryBuilder)
      .mockResolvedValueOnce({
        data: [{ id: 'a1', platform: 'threads', account_handle: 'u1', account_name: 'zoikovertex', access_token: 'tok' }],
        error: null,
      })
      .mockReturnValueOnce(mockQueryBuilder) // update .eq('id')
      .mockResolvedValueOnce({ error: null }); // update .eq('workspace_id')
    respondWith(
      { data: [{ id: '555', text: 'Big news', timestamp: '2026-10-20T10:30:00+0000' }] },
      { id: '555', text: 'Big news', permalink: 'https://www.threads.net/@zoikovertex/post/b' },
    );

    const result = await getPublishedPostMeta('ws-1', 'i1');
    expect(result?.posts[0]).toMatchObject({ post_id: '555', matched: true, error: null });
    expect(mockQueryBuilder.update).toHaveBeenCalledWith({
      platform_posts: [expect.objectContaining({ platform: 'threads', account_id: 'a1', post_id: '555', matched: true })],
    });
  });

  // A disconnect deletes the connected_accounts row and a reconnect inserts a new one with a new id
  describe('after the account was disconnected and reconnected', () => {
    const publishedIntent = (ref: Record<string, unknown>) => ({
      id: 'i1', platform: 'threads', status: 'PUBLISHED', content: 'Hi', created_at: '2026-10-20T10:00:00Z',
      target_account_ids: ['a1'], platform_post_id: null,
      platform_posts: [{ platform: 'threads', account_id: 'a1', post_id: '179', ...ref }],
    });

    /** intent lookup, then: accounts by target id (none live), then all workspace accounts, then the ref save. */
    function mockAccountQueries(workspaceAccounts: unknown[]) {
      mockQueryBuilder.eq
        .mockReturnValueOnce(mockQueryBuilder) // publish_intents .eq('id')
        .mockReturnValueOnce(mockQueryBuilder) // publish_intents .eq('workspace_id')
        .mockResolvedValueOnce({ data: [], error: null }) // connected_accounts by target id
        .mockResolvedValueOnce({ data: workspaceAccounts, error: null }) // connected_accounts in workspace
        .mockReturnValueOnce(mockQueryBuilder) // update .eq('id')
        .mockResolvedValueOnce({ error: null }); // update .eq('workspace_id')
    }

    it('finds the reconnected account by its handle and loads the post', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({ data: publishedIntent({ account_handle: 'u1' }), error: null });
      mockAccountQueries([
        { id: 'a3', platform: 'threads', account_handle: 'u9', account_name: 'other', access_token: 'tok3' },
        { id: 'a2', platform: 'threads', account_handle: 'u1', account_name: 'zoikovertex', access_token: 'tok2' },
      ]);
      respondWith({ id: '179', text: 'Hi', permalink: 'https://www.threads.net/@zoikovertex/post/a' });

      const result = await getPublishedPostMeta('ws-1', 'i1');
      expect(result?.status).toBe('ok');
      expect(result?.posts).toHaveLength(1);
      expect(result?.posts[0]).toMatchObject({ account_id: 'a2', account_name: 'zoikovertex', post_id: '179', error: null });
      expect(result?.posts[0].meta?.permalink).toBe('https://www.threads.net/@zoikovertex/post/a');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('access_token=tok2');
      expect(mockQueryBuilder.update).toHaveBeenCalledWith({
        platform_posts: expect.arrayContaining([
          expect.objectContaining({ platform: 'threads', account_id: 'a2', account_handle: 'u1', post_id: '179' }),
        ]),
      });
    });

    it('uses the only account on the platform when the saved ref has no handle', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({ data: publishedIntent({}), error: null });
      mockAccountQueries([
        { id: 'fb1', platform: 'facebook', account_handle: 'p1', account_name: 'page', access_token: 'tokfb' },
        { id: 'a2', platform: 'threads', account_handle: 'u1', account_name: 'zoikovertex', access_token: 'tok2' },
      ]);
      respondWith({ id: '179', text: 'Hi', permalink: 'https://www.threads.net/@zoikovertex/post/a' });

      const result = await getPublishedPostMeta('ws-1', 'i1');
      expect(result?.status).toBe('ok');
      expect(result?.posts[0]).toMatchObject({ account_id: 'a2', post_id: '179', error: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('https://graph.threads.net/v1.0/179?');
    });

    it('tries each account on the platform until one can load the post', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({ data: publishedIntent({}), error: null });
      mockAccountQueries([
        { id: 'a2', platform: 'threads', account_handle: 'u2', account_name: 'other', access_token: 'tok2' },
        { id: 'a3', platform: 'threads', account_handle: 'u1', account_name: 'zoikovertex', access_token: 'tok3' },
      ]);
      respondWith(
        { error: { message: 'Object does not exist', code: 100 } },
        { id: '179', text: 'Hi', permalink: 'https://www.threads.net/@zoikovertex/post/a' },
      );

      const result = await getPublishedPostMeta('ws-1', 'i1');
      expect(result?.posts).toHaveLength(1);
      expect(result?.posts[0]).toMatchObject({ account_id: 'a3', post_id: '179', error: null });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('still returns no_account when the account was not reconnected', async () => {
      mockQueryBuilder.maybeSingle.mockResolvedValueOnce({ data: publishedIntent({ account_handle: 'u1' }), error: null });
      mockQueryBuilder.eq
        .mockReturnValueOnce(mockQueryBuilder)
        .mockReturnValueOnce(mockQueryBuilder)
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({
          data: [{ id: 'ig1', platform: 'instagram', account_handle: 'u1', account_name: 'zoiko', access_token: 'tok' }],
          error: null,
        });

      const result = await getPublishedPostMeta('ws-1', 'i1');
      expect(result).toEqual({ status: 'no_account', platform: 'threads', posts: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
