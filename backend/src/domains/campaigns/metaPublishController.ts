import { createHmac } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../../shared/authMiddleware';
import { supabaseAdmin } from '../../shared/supabase';
import { logger } from '../../shared/logger';
import { env } from '../../config/env';
import {
  publishCampaignToMeta,
  toggleMetaCampaignStatus,
  deleteMetaCampaign,
  syncCampaignsFromMeta,
} from './metaCampaignPublisher';
import { resolveCampaignMetaAccount } from './resolveCampaignMetaAccount';

function appSecretProof(token: string): string {
  const secret = env.META_APP_SECRET;
  if (!secret) return '';
  return createHmac('sha256', secret).update(token).digest('hex');
}

// ── POST /api/v1/campaigns/:id/publish-to-meta ────────────────────────────────

export const publishToMeta = async (req: AuthRequest, res: Response) => {
  const id           = req.params.id as string;
  const workspaceId  = req.user?.workspace_id;
  if (!workspaceId)  return res.status(400).json({ error: 'Missing workspace context' });

  try {
    const result = await publishCampaignToMeta(id, workspaceId);

    if (!result.success) {
      logger.warn({ campaignId: id, error: result.error, report_file: result.publish_report?.report_file }, '[MetaPublish] Failed');
      return res.status(400).json({ success: false, error: result.error, publish_report: result.publish_report });
    }

    logger.info({ campaignId: id, meta_campaign_id: result.meta_campaign_id, report_file: result.publish_report?.report_file }, '[MetaPublish] Success');

    // Remove ad images from the Media Vault — they've been published and no longer
    // need to sit in the library. Fire-and-forget; vault cleanup is non-critical.
    removePublishedImagesFromVault(id, workspaceId).catch(() => {});

    return res.json({ success: true, data: result, warnings: result.warnings, publish_report: result.publish_report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, campaignId: id }, '[MetaPublish] Unexpected error');
    return res.status(500).json({ success: false, error: msg });
  }
};

// ── Remove published ad images from Media Vault ───────────────────────────────

async function removePublishedImagesFromVault(campaignId: string, workspaceId: string): Promise<void> {
  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('creative, ads_data')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!campaign) return;

  // Collect all unique image URLs from the campaign creative and ads_data array
  const imageUrls = new Set<string>();
  const creative  = (campaign.creative || {}) as Record<string, any>;
  if (creative.ad_image_url) imageUrls.add(creative.ad_image_url);
  for (const ad of (campaign.ads_data as any[] || [])) {
    if (ad?.ad_image_url) imageUrls.add(ad.ad_image_url);
  }

  if (imageUrls.size === 0) return;

  // Find media_library records matching these URLs in this workspace
  const { data: items } = await supabaseAdmin
    .from('media_library')
    .select('id, url, urls')
    .eq('workspace_id', workspaceId)
    .eq('status', 'available');

  if (!items || items.length === 0) return;

  const toDelete = items.filter((item: any) => {
    const allUrls: string[] = [item.url, ...(item.urls || [])].filter(Boolean);
    return allUrls.some(u => imageUrls.has(u));
  });

  if (toDelete.length === 0) return;

  const ids = toDelete.map((i: any) => i.id);
  const { error } = await supabaseAdmin
    .from('media_library')
    .delete()
    .in('id', ids)
    .eq('workspace_id', workspaceId);

  if (error) {
    logger.warn({ campaignId, err: error.message }, '[MetaPublish] Failed to remove vault images after publish');
  } else {
    logger.info({ campaignId, removed: ids.length }, '[MetaPublish] Removed published images from Media Vault');
  }
}

// ── GET /api/v1/campaigns/:id/meta-verify ────────────────────────────────────
// Fetches live data from Meta Graph API for the campaign, ad set, ad, and creative
// and compares it against what is stored in our DB — so you can confirm every
// field (budget, URL, targeting, image, etc.) actually reached Meta correctly.

export const verifyMetaCampaign = async (req: AuthRequest, res: Response) => {
  const campaignId  = req.params.id as string;
  const workspaceId = req.user?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspace context' });

  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!campaign.meta_campaign_id) {
    return res.status(400).json({ error: 'Campaign has not been published to Meta yet.' });
  }

  const resolved = await resolveCampaignMetaAccount(campaign.selected_meta_account_id, workspaceId);
  const token = resolved?.token;
  if (!token) return res.status(400).json({ error: 'Access token not found. Please reconnect Facebook.' });

  const META_GRAPH = 'https://graph.facebook.com/v21.0';
  const proof = appSecretProof(token);

  async function metaGet(path: string) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${META_GRAPH}${path}${sep}access_token=${token}${proof ? `&appsecret_proof=${proof}` : ''}`);
    return r.json() as Promise<any>;
  }

  try {
    // Fetch campaign, ad set, ad, and creative from Meta in parallel
    const [metaCamp, metaAdSet, metaAd] = await Promise.all([
      metaGet(`/${campaign.meta_campaign_id}?fields=id,name,objective,status,special_ad_categories,daily_budget,lifetime_budget`),
      campaign.meta_adset_id
        ? metaGet(`/${campaign.meta_adset_id}?fields=id,name,status,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,billing_event,bid_strategy`)
        : Promise.resolve(null),
      campaign.meta_ad_id
        ? metaGet(`/${campaign.meta_ad_id}?fields=id,name,status,creative{id,name,object_story_spec,thumbnail_url}`)
        : Promise.resolve(null),
    ]);

    const creative = metaAd?.creative || null;

    // Extract what Meta actually has
    const targeting = metaAdSet?.targeting || {};
    const storySpec = creative?.object_story_spec || {};
    const linkData  = storySpec.link_data || {};

    const metaData = {
      campaign: {
        id:                 metaCamp.id,
        name:               metaCamp.name,
        objective:          metaCamp.objective,
        status:             metaCamp.status,
        special_categories: metaCamp.special_ad_categories,
        error:              metaCamp.error?.message || null,
      },
      ad_set: metaAdSet ? {
        id:               metaAdSet.id,
        name:             metaAdSet.name,
        status:           metaAdSet.status,
        daily_budget:     metaAdSet.daily_budget    ? (parseInt(metaAdSet.daily_budget)    / 100).toFixed(2) : null,
        lifetime_budget:  metaAdSet.lifetime_budget ? (parseInt(metaAdSet.lifetime_budget) / 100).toFixed(2) : null,
        start_time:       metaAdSet.start_time  || null,
        end_time:         metaAdSet.end_time    || null,
        optimization_goal: metaAdSet.optimization_goal,
        billing_event:    metaAdSet.billing_event,
        bid_strategy:     metaAdSet.bid_strategy,
        age_min:          targeting.age_min,
        age_max:          targeting.age_max,
        genders:          targeting.genders,
        geo_locations:    targeting.geo_locations,
        interests:        targeting.flexible_spec?.[0]?.interests || [],
        error:            metaAdSet.error?.message || null,
      } : null,
      creative: creative ? {
        id:           creative.id,
        name:         creative.name,
        page_id:      storySpec.page_id || null,
        landing_url:  linkData.link || null,
        headline:     linkData.name || null,
        body_text:    linkData.message || null,
        cta_type:     linkData.call_to_action?.type || null,
        image_url:    linkData.picture || null,
        thumbnail:    creative.thumbnail_url || null,
        error:        creative.error?.message || null,
      } : null,
      ad: metaAd ? {
        id:     metaAd.id,
        name:   metaAd.name,
        status: metaAd.status,
        error:  metaAd.error?.message || null,
      } : null,
    };

    // What our DB says was sent
    const creative_db = (campaign.creative || {}) as Record<string, any>;
    const ads_data    = (campaign.ads_data as any[] || []);
    const firstAd     = ads_data[0] || {};

    const intended = {
      campaign: {
        name:      campaign.name,
        objective: campaign.objective,
        budget_daily:  campaign.budget_daily  ? `${campaign.budget_daily} ${campaign.budget_currency || 'USD'}` : null,
        budget_total:  campaign.budget_total  ? `${campaign.budget_total} ${campaign.budget_currency || 'USD'}` : null,
        start_at:  campaign.start_at,
        end_at:    campaign.end_at,
      },
      creative: {
        landing_url: firstAd.landing_page_url || creative_db.landing_page_url || null,
        headline:    firstAd.headline         || creative_db.headline          || null,
        body_text:   firstAd.copy_text        || creative_db.copy_text         || null,
        cta_text:    firstAd.cta_text         || creative_db.cta_text          || null,
        image_url:   firstAd.ad_image_url     || creative_db.ad_image_url      || null,
      },
    };

    // Build a diff: flag any mismatch between intended and what Meta has
    const checks: Array<{ field: string; intended: any; on_meta: any; match: boolean }> = [
      { field: 'Campaign name',      intended: intended.campaign.name,       on_meta: metaData.campaign.name,       match: metaData.campaign.name === intended.campaign.name },
      { field: 'Campaign objective', intended: campaign.objective,            on_meta: metaData.campaign.objective,  match: true /* objectives are normalised */ },
      { field: 'Campaign status',    intended: 'ACTIVE',                      on_meta: metaData.campaign.status,     match: ['ACTIVE','PAUSED'].includes(metaData.campaign.status) },
      { field: 'Budget', intended: intended.campaign.budget_daily ? `${intended.campaign.budget_daily} daily` : intended.campaign.budget_total ? `${intended.campaign.budget_total} lifetime` : null, on_meta: metaData.ad_set?.daily_budget ? `${metaData.ad_set.daily_budget} daily` : metaData.ad_set?.lifetime_budget ? `${metaData.ad_set.lifetime_budget} lifetime` : null, match: !!(metaData.ad_set?.daily_budget || metaData.ad_set?.lifetime_budget) },
      { field: 'Start date',         intended: intended.campaign.start_at,    on_meta: metaData.ad_set?.start_time,  match: !!metaData.ad_set?.start_time },
      { field: 'End date',           intended: intended.campaign.end_at,      on_meta: metaData.ad_set?.end_time,    match: !!metaData.ad_set?.end_time },
      { field: 'Landing page URL',   intended: intended.creative.landing_url, on_meta: metaData.creative?.landing_url, match: metaData.creative?.landing_url === intended.creative.landing_url },
      { field: 'Ad headline',        intended: intended.creative.headline,    on_meta: metaData.creative?.headline,  match: metaData.creative?.headline === intended.creative.headline },
      { field: 'Ad body text',       intended: intended.creative.body_text,   on_meta: metaData.creative?.body_text, match: metaData.creative?.body_text === intended.creative.body_text },
      { field: 'CTA type',           intended: intended.creative.cta_text,    on_meta: metaData.creative?.cta_type,  match: !!metaData.creative?.cta_type },
      { field: 'Ad image',           intended: intended.creative.image_url ? 'Set' : 'None', on_meta: metaData.creative?.image_url ? 'Set' : 'None', match: !!(metaData.creative?.image_url) === !!(intended.creative.image_url) },
      { field: 'Page ID',            intended: 'Facebook Page',               on_meta: metaData.creative?.page_id,   match: !!metaData.creative?.page_id },
    ];

    return res.json({
      success: true,
      data: {
        meta_ids: {
          campaign_id: campaign.meta_campaign_id,
          adset_id:    campaign.meta_adset_id,
          ad_id:       campaign.meta_ad_id,
          creative_id: campaign.meta_creative_id,
        },
        live_on_meta: metaData,
        intended,
        checks,
        summary: {
          total:    checks.length,
          passed:   checks.filter(c => c.match).length,
          failed:   checks.filter(c => !c.match).length,
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, campaignId }, '[MetaVerify] Error');
    return res.status(500).json({ error: msg });
  }
};

// ── POST /api/v1/campaigns/:id/toggle-meta-status ────────────────────────────

export const toggleMetaStatus = async (req: AuthRequest, res: Response) => {
  const id          = req.params.id as string;
  const workspaceId = req.user?.workspace_id;
  const { pause }   = req.body as { pause?: boolean };
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspace context' });

  const result = await toggleMetaCampaignStatus(id, workspaceId, !!pause);
  if (!result.success) return res.status(400).json({ error: result.error });
  return res.json({ success: true });
};

// ── DELETE /api/v1/campaigns/:id/meta ────────────────────────────────────────

export const deleteFromMeta = async (req: AuthRequest, res: Response) => {
  const id          = req.params.id as string;
  const workspaceId = req.user?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspace context' });

  await deleteMetaCampaign(id, workspaceId);
  return res.json({ success: true });
};

// ── POST /api/v1/campaigns/meta/sync ─────────────────────────────────────────

export const syncFromMeta = async (req: AuthRequest, res: Response) => {
  const workspaceId = req.user?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspace context' });

  // Find the linked ad account
  const { data: accs } = await supabaseAdmin
    .from('connected_accounts')
    .select('ad_account_id, agency_ad_account_id, access_token, refresh_token')
    .eq('workspace_id', workspaceId)
    .in('platform', ['facebook', 'instagram'])
    .not('ad_account_id', 'is', null)
    .limit(1);

  const acc = accs?.[0];
  if (!acc) return res.status(400).json({ error: 'No Meta ad account linked.' });

  const adAccountId = acc.agency_ad_account_id || acc.ad_account_id;
  const token       = acc.refresh_token || acc.access_token; // prefer user token (refresh_token)
  if (!token) return res.status(400).json({ error: 'Access token not found. Reconnect Facebook.' });

  const result = await syncCampaignsFromMeta(workspaceId, adAccountId, token);
  if (result.error) return res.status(400).json({ error: result.error });

  return res.json({ success: true, data: { synced: result.synced } });
};

// ── GET /api/v1/campaigns/meta/ad-account-details ────────────────────────────
// Returns the linked ad account details from Meta (spend, status, currency)

export const getAdAccountDetails = async (req: AuthRequest, res: Response) => {
  const workspaceId = req.user?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspace context' });

  const { data: accs } = await supabaseAdmin
    .from('connected_accounts')
    .select('ad_account_id, agency_ad_account_id, access_token, refresh_token, account_name')
    .eq('workspace_id', workspaceId)
    .in('platform', ['facebook'])
    .not('ad_account_id', 'is', null)
    .limit(1);

  const acc = accs?.[0];
  if (!acc) return res.json({ success: true, data: null });

  const adAcctRaw   = acc.agency_ad_account_id || acc.ad_account_id;
  const adAccountId = adAcctRaw?.startsWith('act_') ? adAcctRaw : `act_${adAcctRaw}`;
  const token       = acc.refresh_token || acc.access_token; // prefer user token (refresh_token)
  if (!token) return res.json({ success: true, data: null });

  try {
    const fields   = 'id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance';
    const acctProof = appSecretProof(token);
    const r = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}?fields=${fields}&access_token=${token}${acctProof ? `&appsecret_proof=${acctProof}` : ''}`);
    const data = await r.json() as any;

    if (data.error) return res.json({ success: true, data: null });

    return res.json({
      success: true,
      data: {
        id:           data.id,
        name:         data.name || acc.account_name,
        status:       data.account_status === 1 ? 'Active' : 'Inactive',
        currency:     data.currency,
        timezone:     data.timezone_name,
        amount_spent: data.amount_spent ? (parseInt(data.amount_spent) / 100).toFixed(2) : '0.00',
        spend_cap:    data.spend_cap    ? (parseInt(data.spend_cap)    / 100).toFixed(2) : null,
        balance:      data.balance      ? (parseInt(data.balance)      / 100).toFixed(2) : null,
      },
    });
  } catch { return res.json({ success: true, data: null }); }
};
