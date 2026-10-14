// Twitch EventSub webhook helpers.
// Twitch pushes chat messages to our /api/twitch/eventsub endpoint
// via HTTP — no persistent connection or separate worker needed.

import crypto from 'crypto';

const HMAC_PREFIX = 'sha256=';

// ── App Access Token (client credentials) ──────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Get a Twitch App Access Token (client credentials flow). Cached in memory. */
export async function getAppAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!r.ok) throw new Error(`App access token failed: ${r.status}`);
  const data = await r.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000, // refresh 5 min early
  };
  return data.access_token;
}

// ── Signature verification ─────────────────────────────────────

export function getEventSubSecret(): string {
  return process.env.EVENTSUB_SECRET || '';
}

/** Verify the HMAC-SHA256 signature on an incoming EventSub webhook. */
export function verifySignature(
  messageId: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const secret = getEventSubSecret();
  if (!secret) return false;

  const hmacMessage = messageId + timestamp + rawBody;
  const expected =
    HMAC_PREFIX +
    crypto.createHmac('sha256', secret).update(hmacMessage).digest('hex');

  // Constant-time comparison
  const expectedBytes=Buffer.from(expected);const signatureBytes=Buffer.from(signature);
  if (expectedBytes.length !== signatureBytes.length) return false;
  return crypto.timingSafeEqual(expectedBytes,signatureBytes);
}

/** Reject messages older than 10 minutes (replay protection). */
export function isTimestampFresh(timestamp: string): boolean {
  const diff = Math.abs(Date.now() - new Date(timestamp).getTime());
  return diff < 10 * 60 * 1000;
}

// ── Idempotency ─────────────────────────────────────────────────

/**
 * Which id to dedup a chat-message notification on: Twitch's stable
 * per-message id when present (identical across every retry/duplicate
 * delivery of the same chat message), falling back to the webhook
 * delivery id otherwise.
 */
export function resolveEventId(event: { message_id?: string }, deliveryMsgId: string): string {
  return event.message_id || deliveryMsgId;
}

export type DedupOutcome = 'process' | 'duplicate' | 'process-with-warning';

/**
 * Decide what to do after attempting to record an event id as seen (via a
 * unique-constrained insert). A unique-violation means another delivery
 * already claimed this id — drop it. Any other error (e.g. the dedup table
 * isn't migrated yet) must NOT be treated as "already seen": that would
 * silently drop real chat messages, so process it anyway and just warn.
 */
export function classifyDedupOutcome(insertError: { code?: string } | null): DedupOutcome {
  if (!insertError) return 'process';
  if (insertError.code === '23505') return 'duplicate';
  return 'process-with-warning';
}

// ── Subscription management ────────────────────────────────────

/**
 * Create an EventSub subscription for `channel.chat.message`.
 * Uses broadcaster's user ID as both broadcaster_user_id and user_id
 * (the broadcaster must have granted `user:read:chat` via OAuth).
 *
 * Returns the subscription ID, or null on failure.
 * If the subscription already exists, Twitch returns 409 — we treat that as success.
 */
export async function createChatSubscription(
  broadcasterUserId: string,
): Promise<string | null> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const secret = getEventSubSecret();
  if (!appUrl || !secret) {
    console.error('Missing NEXT_PUBLIC_APP_URL or EVENTSUB_SECRET');
    return null;
  }

  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  const r = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterUserId,
        user_id: broadcasterUserId,
      },
      transport: {
        method: 'webhook',
        callback: `${appUrl}/api/twitch/eventsub`,
        secret,
      },
    }),
  });

  // 409 = duplicate subscription — that's fine
  if (r.status === 409) {
    console.log(`EventSub chat sub already exists for user ${broadcasterUserId}`);
    return 'existing';
  }

  if (!r.ok) {
    const text = await r.text();
    console.error(`EventSub create failed ${r.status}: ${text}`);
    return null;
  }

  const data = await r.json();
  const sub = data.data?.[0];
  if (sub) {
    console.log(`EventSub chat sub created: ${sub.id} (${sub.status})`);
    return sub.id;
  }
  return null;
}

/**
 * List active EventSub subscriptions for our app.
 * Optionally filter by type.
 */
export async function listSubscriptions(type?: string) {
  const token=await getAppAccessToken();
  const subscriptions: {id:string;type:string;status:string;condition:{broadcaster_user_id:string};transport?:{callback?:string}}[]=[];
  let cursor:string|undefined;const deadline=Date.now()+20000;
  for(let page=0;page<100;page++){
    if(Date.now()>deadline)throw new Error('Twitch subscription listing timed out');
    const url=new URL('https://api.twitch.tv/helix/eventsub/subscriptions');url.searchParams.set('first','100');
    if(type)url.searchParams.set('type',type);if(cursor)url.searchParams.set('after',cursor);
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,'Client-Id':process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Could not read Twitch subscriptions');
    const data=await response.json();subscriptions.push(...(data.data || []));cursor=data.pagination?.cursor;
    if(!cursor)return subscriptions;
  }
  throw new Error('Twitch subscription listing exceeded its page bound');
}

/**
 * Delete every webhook subscription whose callback doesn't match the current
 * NEXT_PUBLIC_APP_URL — i.e. leftovers pointing at an old domain that would
 * otherwise keep delivering (causing duplicate chat ingestion after a domain
 * change). Paginates through all subscriptions. Guarded: refuses to run if the
 * app URL is unset, so it can never delete the live subscriptions by mistake.
 */
export async function pruneStaleSubscriptions(): Promise<{
  deleted: number;
  kept: number;
  expectedCallback: string;
  deletedCallbacks: Record<string, number>;
}> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set — refusing to prune');
  const expectedCallback = `${appUrl}/api/twitch/eventsub`;

  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  let deleted = 0;
  let kept = 0;
  const deletedCallbacks: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const u = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
    if (cursor) u.searchParams.set('after', cursor);
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
    });
    if (!r.ok) throw new Error(`List subscriptions failed: ${r.status}`);
    const data = await r.json();
    for (const sub of data.data || []) {
      const cb: string = sub.transport?.callback || '';
      // Only webhook subs have a callback; mismatch → stale → delete.
      if (cb && cb !== expectedCallback) {
        if (await deleteSubscription(sub.id)) {
          deleted++;
          deletedCallbacks[cb] = (deletedCallbacks[cb] || 0) + 1;
        }
      } else {
        kept++;
      }
    }
    cursor = data.pagination?.cursor;
  } while (cursor);

  return { deleted, kept, expectedCallback, deletedCallbacks };
}

/** Delete an EventSub subscription by ID. */
export async function deleteSubscription(subscriptionId: string): Promise<boolean> {
  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  const r = await fetch(
    `https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': clientId,
      },
    },
  );
  return r.ok || r.status === 404;
}

export function broadcastCallbackConfiguration(): {callback:string;secret:string}|null {
 const raw=(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/,'');const secret=getEventSubSecret();
 if(!raw || !secret || !process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET)return null;
 try{const url=new URL(raw);if(url.protocol!=='https:' || url.username || url.password)return null;return {callback:raw+'/api/twitch/eventsub',secret};}catch{return null;}
}
export async function createBroadcastSubscription(type:'stream.online'|'stream.offline',broadcasterUserId:string):Promise<boolean> {
 const config=broadcastCallbackConfiguration();if(!config)return false;
 const token=await getAppAccessToken();
 const response=await fetch('https://api.twitch.tv/helix/eventsub/subscriptions',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Client-Id':process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!,'Content-Type':'application/json'},body:JSON.stringify({type,version:'1',condition:{broadcaster_user_id:broadcasterUserId},transport:{method:'webhook',callback:config.callback,secret:config.secret}}),signal:AbortSignal.timeout(8000)});
 if(response.status===409){const subscriptions=await listSubscriptions(type);return subscriptions.some((s:{condition:{broadcaster_user_id:string};status:string;transport?:{callback?:string}})=>s.condition.broadcaster_user_id===broadcasterUserId && ['enabled','webhook_callback_verification_pending'].includes(s.status) && s.transport?.callback===config.callback);}
 if(!response.ok)return false;
 const data=await response.json();return !!data.data?.[0]?.id;
}
// Explicit owner repair affects only this app's lifecycle subscriptions for
// their broadcaster; it never deletes chat or another channel's subscription.
export async function repairBroadcastSubscriptions(broadcasterUserId:string):Promise<boolean> {
 for(const type of ['stream.online','stream.offline'] as const){
  const subscriptions=await listSubscriptions(type);
  for(const subscription of subscriptions){if(subscription.condition.broadcaster_user_id===broadcasterUserId && !(await deleteSubscription(subscription.id)))return false;}
 }
 return true;
}
