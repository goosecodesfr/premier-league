// Notifications: in-app inbox rows, Web Push to installed apps, and optional league-wide
// messages to a Discord channel (webhook) and/or a Telegram group (bot).
import { AsyncLocalStorage } from 'node:async_hooks';
import webpush from 'web-push';
import { db, type Db } from '../db.ts';

export type NotifType = 'deadline' | 'result' | 'digest' | 'bid' | 'injury' | 'transfer' | 'news' | 'contract' | 'event' | 'system' | 'kickoff';

export const DEFAULT_PREFS: Record<NotifType, boolean> = {
  deadline: true, result: true, digest: true, bid: true, injury: true, contract: true, event: true, system: true,
  transfer: false, news: false, kickoff: false,
};

interface PushMsg { userId: number; title: string; body: string; url: string; type: NotifType }
interface ChannelMsg { text: string }

// Messages queue up while work runs inside a transaction and are only sent once it commits.
// Each request / job gets its own queue (AsyncLocalStorage) so concurrent work never mixes.
interface Outbox { push: PushMsg[]; channel: ChannelMsg[] }
const als = new AsyncLocalStorage<Outbox>();
const globalBox: Outbox = { push: [], channel: [] };
const box = (): Outbox => als.getStore() ?? globalBox;

/** A fresh outbox for a request: run work inside it, flush it after the response is sent. */
export function newOutbox(): Outbox { return { push: [], channel: [] }; }
export function runInOutbox<T>(ob: Outbox, fn: () => Promise<T>): Promise<T> { return als.run(ob, fn); }
export function flushBox(ob: Outbox) { return als.run(ob, () => flushOutbox()); }

/** Run fn with its own outbox; flushes on success, discards on failure. */
export async function withOutbox<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ push: [], channel: [] }, async () => {
    try {
      const out = await fn();
      await flushOutbox();
      return out;
    } catch (e) {
      discardOutbox();
      throw e;
    }
  });
}

export async function notifyUser(d: Db, userId: number, n: { type: NotifType; title: string; body?: string; link?: string; clubId?: number | null; push?: boolean }) {
  await d.q('insert into notifications (user_id, club_id, type, title, body, link) values ($1, $2, $3, $4, $5, $6)', [
    userId, n.clubId ?? null, n.type, n.title.slice(0, 200), (n.body ?? '').slice(0, 1000), n.link ?? null,
  ]);
  if (n.push !== false) box().push.push({ userId, title: n.title, body: n.body ?? '', url: n.link ?? '/', type: n.type });
}

export async function notifyClub(d: Db, clubId: number, n: { type: NotifType; title: string; body?: string; link?: string; push?: boolean }) {
  const c = await d.one<{ user_id: number | null }>(`select user_id from clubs where id = $1 and manager_type = 'human'`, [clubId]);
  if (c?.user_id) await notifyUser(d, c.user_id, { ...n, clubId });
}

/** Message every human manager (inbox + push) and post to the group channel. */
export async function broadcast(d: Db, n: { type: NotifType; title: string; body?: string; link?: string; channel?: boolean; channelText?: string }) {
  const users = await d.many<{ id: number }>('select id from users');
  for (const u of users) await notifyUser(d, u.id, n);
  if (n.channel !== false) box().channel.push({ text: n.channelText ?? `**${n.title}**${n.body ? `\n${n.body}` : ''}` });
}

export function postToChannel(text: string) {
  box().channel.push({ text });
}

export function discardOutbox() {
  const b = box();
  b.push = [];
  b.channel = [];
}

interface Integrations { discordWebhook?: string; telegramBotToken?: string; telegramChatId?: string; appUrl?: string }

export async function getIntegrations(): Promise<Integrations> {
  const row = await db.one<{ value: Integrations }>(`select value from app_settings where key = 'integrations'`);
  return row?.value ?? {};
}

/** Send everything queued by committed work. Never throws. */
export async function flushOutbox(): Promise<{ push: number; channel: number }> {
  const b = box();
  const pushes = b.push;
  const channel = b.channel;
  b.push = [];
  b.channel = [];
  let sent = 0;
  try {
    if (pushes.length) {
      const vapid = await db.one<{ value: { publicKey: string; privateKey: string } }>(`select value from app_settings where key = 'vapid'`);
      const integ = await getIntegrations();
      if (vapid) {
        webpush.setVapidDetails(`mailto:league@${hostOf(integ.appUrl) ?? 'example.com'}`, vapid.value.publicKey, vapid.value.privateKey);
        const userIds = [...new Set(pushes.map((p) => p.userId))];
        const subs = await db.many<{ id: number; user_id: number; endpoint: string; keys: { p256dh: string; auth: string }; prefs: Record<string, unknown> }>(
          `select s.id, s.user_id, s.endpoint, s.keys, u.prefs from push_subs s join users u on u.id = s.user_id where s.user_id = any($1)`,
          [userIds],
        );
        // Collapse to at most 4 pushes per user per flush (a round of results shouldn't buzz ten times).
        const perUser = new Map<number, PushMsg[]>();
        for (const p of pushes) (perUser.get(p.userId) ?? perUser.set(p.userId, []).get(p.userId)!).push(p);
        await Promise.all(subs.map(async (s) => {
          const prefs = (s.prefs?.notify ?? {}) as Partial<Record<NotifType, boolean>>;
          const msgs = (perUser.get(s.user_id) ?? []).filter((m) => prefs[m.type] ?? DEFAULT_PREFS[m.type]).slice(0, 4);
          for (const m of msgs) {
            try {
              await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.type }), { TTL: 60 * 60 * 12 });
              sent++;
            } catch (e) {
              const code = (e as { statusCode?: number }).statusCode;
              if (code === 404 || code === 410) await db.q('delete from push_subs where id = $1', [s.id]).catch(() => {});
            }
          }
        }));
      }
    }
    if (channel.length) {
      const integ = await getIntegrations();
      const text = channel.map((c) => c.text).join('\n\n').slice(0, 1900);
      if (integ.discordWebhook) {
        await fetch(integ.discordWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text }) }).catch(() => {});
      }
      if (integ.telegramBotToken && integ.telegramChatId) {
        await fetch(`https://api.telegram.org/bot${integ.telegramBotToken}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: integ.telegramChatId, text: text.replace(/\*\*/g, ''), disable_web_page_preview: true }),
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('flushOutbox failed', e);
  }
  return { push: sent, channel: channel.length };
}

function hostOf(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}
