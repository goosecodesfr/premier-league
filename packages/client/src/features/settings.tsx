// Settings: account, notifications, appearance, league info; and the admin console.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Copy, KeyRound, LogOut, Pause, Play, RefreshCw, Rocket, Share2, Shield, Smartphone, Trash2, UserMinus, Users } from 'lucide-react';
import type { AdminData } from '@ffm/server/routes/system';
import type { TableData } from '@ffm/server/routes/league';
import { api } from '../lib/api';
import { ago, dateLabel, kickoff } from '../lib/format';
import { copyText, currentPushState, disablePush, enablePush, isIOS, isStandalone, pushSupported } from '../lib/device';
import { Badge, Button, Card, Chip, Field, List, ListRow, Q, Screen, Section, Segmented, Select, Sheet, Toggle, inputCls, useConfirm, useToast } from '../components/ui';
import { ClubCrest } from '../components/domain';
import { useMe } from '../app/session';

const NOTIFY_LABELS: Record<string, { label: string; desc: string }> = {
  deadline: { label: 'Deadlines', desc: 'A reminder before team sheets lock' },
  result: { label: 'Results', desc: 'Your full-time scores' },
  bid: { label: 'Bids and offers', desc: 'Offers for your players, counter-offers' },
  injury: { label: 'Injuries', desc: 'When one of your players gets hurt' },
  contract: { label: 'Contracts', desc: 'Expiring deals' },
  event: { label: 'Club decisions', desc: 'Things that need your call' },
  digest: { label: 'Weekly digest', desc: 'The week in the league, every week' },
  system: { label: 'League announcements', desc: 'Season start, windows opening' },
  transfer: { label: 'Transfer news', desc: 'Deals involving your club' },
  news: { label: 'Big news', desc: 'Sackings, trophies, cup draws' },
  kickoff: { label: 'Kick-offs', desc: 'When your match starts' },
};

export function Settings() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(me.user.displayName);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const table = useQuery({ queryKey: ['table', null], queryFn: () => api.get<TableData>('/league/table') });
  const saveName = useMutation({ mutationFn: () => api.put('/me', { displayName: name }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast('Saved', 'success'); } });
  const prefs = useMutation({ mutationFn: (p: Record<string, unknown>) => api.put('/me', { prefs: p }), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  const changePw = useMutation({ mutationFn: () => api.put('/me/password', pw), onSuccess: () => { setPwOpen(false); setPw({ current: '', next: '' }); toast('Password changed', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const logout = useMutation({ mutationFn: () => api.post('/auth/logout'), onSuccess: async () => { await qc.resetQueries(); nav('/login', { replace: true }); } });
  const leave = useMutation({ mutationFn: () => api.post('/club/leave', { confirm: true }), onSuccess: async () => { await qc.invalidateQueries(); nav('/onboarding/club', { replace: true }); } });
  const humans = (table.data?.rows ?? []).filter((r) => r.club.human);
  return (
    <Screen title="Settings" back="/club">
      <Section title="Account">
        <Card>
          <Field label="Display name"><div className="flex gap-2"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} /><Button variant="secondary" disabled={name === me.user.displayName || !name.trim()} loading={saveName.isPending} onClick={() => saveName.mutate()}>Save</Button></div></Field>
          <div className="t-label text-fg2">Username: <b className="text-fg">{me.user.username}</b></div>
          <Button className="mt-3" variant="secondary" size="sm" icon={<KeyRound size={15} />} onClick={() => setPwOpen(true)}>Change password</Button>
        </Card>
      </Section>
      <Section title="App">
        <List>
          <ListRow icon={<Bell size={18} />} title="Notifications" subtitle="Push alerts and what you hear about" to="/settings/notifications" />
          <div className="flex items-center justify-between px-4 min-h-14"><span className="t-body">Reduce motion</span><Toggle checked={!!me.user.prefs.reducedMotion} onChange={(v) => prefs.mutate({ reducedMotion: v })} /></div>
          <div className="flex items-center justify-between px-4 min-h-14"><span className="t-body">Vibration on goals</span><Toggle checked={me.user.prefs.haptics !== false} onChange={(v) => prefs.mutate({ haptics: v })} /></div>
        </List>
        {!isStandalone() && (
          <Card className="mt-2"><div className="flex gap-3"><Smartphone size={20} className="shrink-0" /><div className="t-label text-fg2">{isIOS() ? <>Install on iPhone: tap Share, then <b className="text-fg">Add to Home Screen</b>. Push notifications on iPhone only work from the installed app.</> : <>Install the app from your browser menu (<b className="text-fg">Install app</b> / <b className="text-fg">Add to Home screen</b>) for a full-screen experience and notifications.</>}</div></div></Card>
        )}
      </Section>
      <Section title="League">
        <Card>
          <div className="t-strong">{me.world?.name}</div>
          <div className="t-label text-fg2">Season {me.world?.season} · {me.world?.phase === 'preseason' ? 'Pre-season' : me.world?.phase === 'postseason' ? 'Season over' : 'In season'}{me.world?.paused ? ' · paused' : ''}</div>
          <div className="t-label text-fg2 mt-1">Matches on {me.world?.settings.leagueDays.map((d) => d.toUpperCase()).join(' + ')} at {me.world?.settings.kickoffTime} ({me.world?.timezone}). Team sheets lock {me.world?.settings.deadlineMinutes} minutes before kick-off.</div>
        </Card>
        {humans.length > 0 && (
          <List className="mt-2">
            {humans.map((r) => <Link key={r.club.id} to={`/club/${r.club.id}`} className="flex items-center gap-3 px-4 h-14 active:bg-raised"><ClubCrest club={r.club} size={30} /><span className="flex-1"><span className="t-strong block">{r.club.managerName}</span><span className="t-label text-fg3">{r.club.name}</span></span>{table.data?.started && <span className="t-label text-fg2">{r.pos}{['th', 'st', 'nd', 'rd'][r.pos % 10 > 3 || Math.floor(r.pos / 10) === 1 ? 0 : r.pos % 10]}</span>}</Link>)}
          </List>
        )}
      </Section>
      {me.user.isAdmin && (
        <Section title="Admin"><List><ListRow icon={<Shield size={18} />} title="League admin" subtitle="Invites, members, schedule, integrations" to="/settings/admin" /></List></Section>
      )}
      <Section title="Your club">
        <List>
          <ListRow icon={<UserMinus size={18} className="text-negative" />} title={<span className="text-negative">Hand your club back</span>} subtitle="A bot takes over. You can pick another free club." onClick={async () => {
            if (await confirm({ title: `Leave ${me.club?.name}?`, body: 'A bot manager takes over straight away. Your account stays and you can pick any club nobody else manages.', confirm: 'Leave club', destructive: true })) leave.mutate();
          }} />
          <ListRow icon={<LogOut size={18} />} title="Sign out" onClick={() => logout.mutate()} />
        </List>
      </Section>
      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Change password" footer={<Button full loading={changePw.isPending} disabled={pw.next.length < 6} onClick={() => changePw.mutate()}>Change password</Button>}>
        <Field label="Current password"><input className={inputCls} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 6 characters. Other devices get signed out."><input className={inputCls} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
      </Sheet>
    </Screen>
  );
}

export function NotificationSettings() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<string>('checking');
  useEffect(() => { currentPushState().then(setState).catch(() => setState('unsupported')); }, []);
  const prefs = useMutation({ mutationFn: (n: Record<string, boolean>) => api.put('/me', { prefs: { notify: n } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  const test = useMutation({ mutationFn: () => api.post<{ devices: number }>('/push/test'), onSuccess: (r) => toast(r.devices ? `Sent to ${r.devices} device${r.devices > 1 ? 's' : ''}` : 'No devices subscribed yet', r.devices ? 'success' : 'error') });
  return (
    <Screen title="Notifications" back="/settings">
      <Card className="mb-5">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-accent" />
          <div className="flex-1">
            <div className="t-strong">Push notifications on this device</div>
            <div className="t-label text-fg2">{state === 'on' ? 'On' : state === 'off' ? 'Off' : state === 'denied' ? 'Blocked in your browser settings' : state === 'unsupported' ? (isIOS() && !isStandalone() ? 'Add the app to your Home Screen first' : 'Not supported in this browser') : 'Checking…'}</div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {state === 'off' && me.vapidPublic && <Button size="sm" onClick={async () => { const r = await enablePush(me.vapidPublic!).catch(() => 'unsupported'); setState(r === 'on' ? 'on' : r); }}>Turn on</Button>}
          {state === 'on' && <Button size="sm" variant="secondary" onClick={async () => { await disablePush(); setState('off'); }}>Turn off</Button>}
          {state === 'on' && <Button size="sm" variant="ghost" loading={test.isPending} onClick={() => test.mutate()}>Send a test</Button>}
        </div>
        {!pushSupported() && <div className="t-label text-fg3 mt-2">Everything still appears in your in-app inbox (the bell on Home).</div>}
      </Card>
      <Section title="What you hear about">
        <List>
          {Object.entries(NOTIFY_LABELS).map(([k, v]) => (
            <label key={k} className="flex items-center gap-3 px-4 min-h-14 py-2">
              <span className="flex-1"><span className="t-body block">{v.label}</span><span className="t-label text-fg3">{v.desc}</span></span>
              <Toggle checked={me.user.prefs.notify[k as keyof typeof me.user.prefs.notify] ?? false} onChange={(on) => prefs.mutate({ [k]: on })} label={v.label} />
            </label>
          ))}
        </List>
      </Section>
    </Screen>
  );
}

// ---------------------------------------------------------------- admin
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function Admin() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin'], queryFn: () => api.get<AdminData>('/admin'), refetchInterval: 30_000 });
  const inv = () => qc.invalidateQueries();
  const [newInvite, setNewInvite] = useState<string | null>(null);
  const [inviteUses, setInviteUses] = useState(1);
  const [tempPw, setTempPw] = useState<{ user: string; pw: string } | null>(null);
  const [resetText, setResetText] = useState('');
  const [integ, setInteg] = useState({ discordWebhook: '', telegramBotToken: '', telegramChatId: '' });
  const [settings, setSettings] = useState<AdminData['world'] extends infer W ? (W extends { settings: infer S } ? S : never) : never | null>(null as never);
  useEffect(() => { if (q.data?.world && !settings) setSettings(q.data.world.settings as never); }, [q.data, settings]);
  const mk = <T,>(fn: (v: T) => Promise<unknown>, ok: string) => useMutation({ mutationFn: fn, onSuccess: () => { inv(); toast(ok, 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const createInvite = useMutation({ mutationFn: () => api.post<{ code: string }>('/admin/invites', { maxUses: inviteUses }), onSuccess: (r) => { setNewInvite(r.code); inv(); } });
  const delInvite = mk((code: string) => api.del(`/admin/invites/${code}`), 'Invite deleted');
  const pause = mk((p: boolean) => api.post('/admin/pause', { paused: p }), 'Updated');
  const start = mk((_: void) => api.post('/admin/start-season'), 'Season scheduled!');
  const tick = useMutation({ mutationFn: () => api.post<{ ran: { type: string; error?: string }[]; skipped?: string }>('/admin/tick'), onSuccess: (r) => { inv(); toast(r.skipped ? `Skipped: ${r.skipped}` : r.ran.length ? `Ran ${r.ran.length} job${r.ran.length > 1 ? 's' : ''}` : 'Nothing was due', 'success'); } });
  const retry = mk((_: void) => api.post('/admin/jobs/retry'), 'Failed jobs queued again');
  const resetPw = useMutation({ mutationFn: (u: { id: number; username: string }) => api.post<{ password: string }>(`/admin/users/${u.id}/reset-password`), onSuccess: (r, u) => setTempPw({ user: u.username, pw: r.password }) });
  const makeAdmin = mk((x: { id: number; on: boolean }) => api.post(`/admin/users/${x.id}/admin`, { isAdmin: x.on }), 'Updated');
  const release = mk((id: number) => api.post(`/admin/users/${id}/release`), 'Club handed to a bot');
  const removeUser = mk((id: number) => api.del(`/admin/users/${id}`), 'Member removed');
  const saveSettings = useMutation({ mutationFn: () => api.put<{ note: string | null }>('/admin/settings', { settings }), onSuccess: (r) => { inv(); toast(r.note ?? 'Settings saved', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const saveInteg = useMutation({ mutationFn: () => api.put('/admin/integrations', Object.fromEntries(Object.entries(integ).filter(([, v]) => v !== ''))), onSuccess: () => { inv(); toast('Saved', 'success'); setInteg({ discordWebhook: '', telegramBotToken: '', telegramChatId: '' }); }, onError: (e: Error) => toast(e.message, 'error') });
  const testInteg = mk((_: void) => api.post('/admin/integrations/test'), 'Test message sent');
  const reset = useMutation({ mutationFn: () => api.post('/admin/reset-world', { confirm: 'RESET' }), onSuccess: () => { inv(); toast('The league has been reset', 'success'); setResetText(''); }, onError: (e: Error) => toast(e.message, 'error') });
  const origin = window.location.origin;
  return (
    <Screen title="League admin" back="/settings">
      <Q q={q}>
        {(d) => {
          const w = d.world;
          const stale = !w?.lastTickAt || Date.now() - new Date(w.lastTickAt).getTime() > 40 * 60_000;
          return (
            <>
              <Section title="Status">
                <Card>
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="t-caption text-fg3">Phase</div><div className="t-strong capitalize">{w?.phase}{w?.paused ? ' (paused)' : ''}</div></div>
                    <div><div className="t-caption text-fg3">Season</div><div className="t-strong">{w?.season}</div></div>
                    <div><div className="t-caption text-fg3">Clock last ran</div><div className={stale ? 't-strong text-warning' : 't-strong'}>{w?.lastTickAt ? ago(w.lastTickAt) : 'never'}</div></div>
                    <div><div className="t-caption text-fg3">Next job</div><div className="t-strong">{d.jobs.next ? kickoff(d.jobs.next) : '-'}</div></div>
                    <div><div className="t-caption text-fg3">Jobs due / queued</div><div className="t-strong">{d.jobs.due} / {d.jobs.pending}</div></div>
                    <div><div className="t-caption text-fg3">Database</div><div className="t-strong">{d.dbSizeMb ?? '?'} MB of 500</div></div>
                  </div>
                  {stale && <div className="t-label text-warning mt-3">The scheduler has not called in for a while. Check your cron-job.org job (see below). Visits to the app also nudge the clock.</div>}
                  {d.jobs.failed.length > 0 && (
                    <div className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--negative)_12%,transparent)] p-3">
                      <div className="t-label text-negative">{d.jobs.failed.length} job(s) failed</div>
                      {d.jobs.failed.map((j) => <div key={j.id} className="t-label text-fg2 truncate">{j.type}: {j.last_error?.split('\n')[0]}</div>)}
                      <Button className="mt-2" size="sm" variant="secondary" onClick={() => retry.mutate()}>Retry failed jobs</Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {w?.phase === 'preseason' && !w.started && <Button size="sm" icon={<Rocket size={15} />} loading={start.isPending} onClick={async () => { if (await confirm({ title: 'Start the season?', body: 'Fixtures are generated now. The first matchday is at least two days away, and the transfer window stays open until then.', confirm: 'Start season' })) start.mutate(); }}>Start season</Button>}
                    <Button size="sm" variant="secondary" icon={w?.paused ? <Play size={15} /> : <Pause size={15} />} onClick={() => pause.mutate(!w?.paused)}>{w?.paused ? 'Resume' : 'Pause'} the clock</Button>
                    <Button size="sm" variant="secondary" icon={<RefreshCw size={15} />} loading={tick.isPending} onClick={() => tick.mutate()}>Run due jobs now</Button>
                  </div>
                  {d.jobs.upcoming.length > 0 && <div className="t-label text-fg3 mt-3">Coming up: {d.jobs.upcoming.slice(0, 4).map((j) => `${j.type} ${kickoff(new Date(j.run_at).toISOString())}`).join(' · ')}</div>}
                </Card>
              </Section>

              <Section title="Invite friends">
                <Card>
                  <div className="flex items-center gap-2">
                    <Select className="!w-[140px]" ariaLabel="Uses" value={inviteUses} onChange={setInviteUses} options={[1, 5, 10, 25].map((n) => ({ value: n, label: n === 1 ? 'Single use' : `${n} uses` }))} />
                    <Button loading={createInvite.isPending} onClick={() => createInvite.mutate()}>Create invite</Button>
                  </div>
                  {newInvite && (
                    <div className="mt-3 rounded-xl bg-raised p-3">
                      <div className="t-display-sm tracking-widest">{newInvite}</div>
                      <div className="t-label text-fg2 break-all">{origin}/register?code={newInvite}</div>
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={async () => { if (await copyText(`${origin}/register?code=${newInvite}`)) toast('Link copied', 'success'); }}>Copy link</Button>
                        {'share' in navigator && <Button size="sm" variant="secondary" icon={<Share2 size={14} />} onClick={() => navigator.share({ text: `Join our football manager league: ${origin}/register?code=${newInvite}` }).catch(() => {})}>Share</Button>}
                      </div>
                    </div>
                  )}
                </Card>
                {d.invites.length > 0 && (
                  <List className="mt-2">
                    {d.invites.map((i) => (
                      <div key={i.code} className="flex items-center gap-3 px-4 h-14">
                        <span className="flex-1"><span className="t-strong tracking-wider block">{i.code}</span><span className="t-label text-fg3">{i.uses}/{i.max_uses} used{i.note ? ` · ${i.note}` : ''}</span></span>
                        <button aria-label="Copy" className="text-fg3" onClick={async () => { if (await copyText(`${origin}/register?code=${i.code}`)) toast('Link copied', 'success'); }}><Copy size={16} /></button>
                        <button aria-label="Delete invite" className="text-fg3" onClick={() => delInvite.mutate(i.code)}><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </List>
                )}
              </Section>

              <Section title={`Members · ${d.users.length}`}>
                <List>
                  {d.users.map((u) => (
                    <div key={u.id} className="px-4 py-3">
                      <div className="flex items-center gap-2"><Users size={16} className="text-fg3" /><span className="t-strong flex-1">{u.display_name} <span className="t-label text-fg3">@{u.username}</span></span>{u.is_admin && <Badge tone="accent">Admin</Badge>}</div>
                      <div className="t-label text-fg2 mt-0.5">{u.club ?? 'No club'} · {u.last_seen_at ? `seen ${ago(u.last_seen_at)}` : 'never seen'} · {u.devices} device{u.devices === 1 ? '' : 's'} for push</div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button size="sm" variant="secondary" onClick={async () => { if (await confirm({ title: `Reset ${u.username}'s password?`, body: 'You will get a temporary password to send them.', confirm: 'Reset' })) resetPw.mutate({ id: u.id, username: u.username }); }}>Reset password</Button>
                        <Button size="sm" variant="ghost" onClick={() => makeAdmin.mutate({ id: u.id, on: !u.is_admin })}>{u.is_admin ? 'Remove admin' : 'Make admin'}</Button>
                        {u.club && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Take ${u.club} off ${u.display_name}?`, body: 'A bot takes over the club.', confirm: 'Release', destructive: true })) release.mutate(u.id); }}>Release club</Button>}
                        <Button size="sm" variant="ghost" className="text-negative" onClick={async () => { if (await confirm({ title: `Remove ${u.display_name}?`, body: 'Their account is deleted and their club goes to a bot.', confirm: 'Remove', destructive: true })) removeUser.mutate(u.id); }}>Remove</Button>
                      </div>
                    </div>
                  ))}
                </List>
              </Section>

              {settings && (
                <Section title="League settings">
                  <Card>
                    <Field label="Match days"><div className="flex flex-wrap gap-2">{DAYS.map((dd) => <Chip key={dd} selected={settings.leagueDays.includes(dd as never)} onClick={() => setSettings({ ...settings, leagueDays: (settings.leagueDays.includes(dd as never) ? settings.leagueDays.filter((x) => x !== dd) : [...settings.leagueDays, dd]) as never })}>{dd.toUpperCase()}</Chip>)}</div></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Kick-off"><input className={inputCls} type="time" value={settings.kickoffTime} onChange={(e) => setSettings({ ...settings, kickoffTime: e.target.value })} /></Field>
                      <Field label="Lock before (min)"><input className={inputCls} inputMode="numeric" value={settings.deadlineMinutes} onChange={(e) => setSettings({ ...settings, deadlineMinutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
                      <Field label="Reminder (hours)"><input className={inputCls} inputMode="numeric" value={settings.reminderHours} onChange={(e) => setSettings({ ...settings, reminderHours: Number(e.target.value.replace(/\D/g, '')) || 1 })} /></Field>
                      <Field label="Pre-season (days)"><input className={inputCls} inputMode="numeric" value={settings.preseasonDays} onChange={(e) => setSettings({ ...settings, preseasonDays: Number(e.target.value.replace(/\D/g, '')) || 1 })} /></Field>
                    </div>
                    <Field label="Bot managers"><Segmented value={settings.difficulty} onChange={(v) => setSettings({ ...settings, difficulty: v })} options={[{ value: 'casual', label: 'Relaxed' }, { value: 'standard', label: 'Standard' }, { value: 'competitive', label: 'Sharp' }]} /></Field>
                    <Field label="Random events"><Segmented value={settings.eventsFrequency} onChange={(v) => setSettings({ ...settings, eventsFrequency: v })} options={[{ value: 'low', label: 'Rare' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Frequent' }]} /></Field>
                    <div className="flex items-center justify-between h-12"><span className="t-body">European competitions</span><Toggle checked={settings.europe} onChange={(v) => setSettings({ ...settings, europe: v })} /></div>
                    <div className="flex items-center justify-between h-12"><span className="t-body">Domestic cups</span><Toggle checked={settings.cups} onChange={(v) => setSettings({ ...settings, cups: v })} /></div>
                    <div className="flex items-center justify-between h-12"><span className="t-body">Promotion and relegation</span><Toggle checked={settings.reshuffle} onChange={(v) => setSettings({ ...settings, reshuffle: v })} /></div>
                    <div className="flex items-center justify-between h-12"><span className="t-body">Elite clubs bot-only</span><Toggle checked={settings.clubPick === 'no_elite'} onChange={(v) => setSettings({ ...settings, clubPick: v ? 'no_elite' : 'free' })} /></div>
                    <Button className="mt-2" full loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Save settings</Button>
                    <div className="t-label text-fg3 mt-2">Changes to match days, times and competitions apply when the next season is scheduled.</div>
                  </Card>
                </Section>
              )}

              <Section title="Scheduler (always-on clock)">
                <Card>
                  <div className="t-body text-fg2">The game advances when this URL is called. Set up a free cron job at <b className="text-fg">cron-job.org</b> to call it every 15 minutes with the header <code className="text-fg">Authorization: Bearer &lt;APP_SECRET&gt;</code>.</div>
                  <div className="mt-2 rounded-lg bg-input px-3 py-2 t-label break-all">{origin}/api/cron/tick</div>
                  <Button className="mt-2" size="sm" variant="secondary" icon={<Copy size={14} />} onClick={async () => { if (await copyText(`${origin}/api/cron/tick`)) toast('Copied', 'success'); }}>Copy URL</Button>
                  <div className="t-label text-fg3 mt-2">APP_SECRET is configured: {d.secretConfigured ? 'yes' : 'NO - add it in your hosting settings'}.</div>
                </Card>
              </Section>

              <Section title="Group chat">
                <Card>
                  <div className="t-body text-fg2 mb-3">Post results, big transfers and the weekly digest into your Discord or Telegram group.</div>
                  <div className="flex gap-2 mb-3"><Badge tone={d.integrations.discord ? 'positive' : 'neutral'}>Discord {d.integrations.discord ? 'on' : 'off'}</Badge><Badge tone={d.integrations.telegram ? 'positive' : 'neutral'}>Telegram {d.integrations.telegram ? 'on' : 'off'}</Badge></div>
                  <Field label="Discord webhook URL" hint="Server settings → Integrations → Webhooks → New webhook → Copy URL"><input className={inputCls} placeholder={d.integrations.discord ? '(saved - paste to replace)' : 'https://discord.com/api/webhooks/…'} value={integ.discordWebhook} onChange={(e) => setInteg({ ...integ, discordWebhook: e.target.value })} /></Field>
                  <Field label="Telegram bot token" hint="Create a bot with @BotFather and add it to your group"><input className={inputCls} placeholder={d.integrations.telegram ? '(saved - paste to replace)' : '123456:ABC-…'} value={integ.telegramBotToken} onChange={(e) => setInteg({ ...integ, telegramBotToken: e.target.value })} /></Field>
                  <Field label="Telegram chat id"><input className={inputCls} placeholder={d.integrations.telegramChatId ?? '-100…'} value={integ.telegramChatId} onChange={(e) => setInteg({ ...integ, telegramChatId: e.target.value })} /></Field>
                  <div className="flex gap-2"><Button loading={saveInteg.isPending} onClick={() => saveInteg.mutate()}>Save</Button><Button variant="secondary" loading={testInteg.isPending} onClick={() => testInteg.mutate()}>Send test</Button></div>
                </Card>
              </Section>

              <Section title="Danger zone">
                <Card className="!border-negative/50">
                  <div className="t-strong text-negative">Reset the league</div>
                  <div className="t-label text-fg2 mt-1">Deletes every season, result, transfer and club change and rebuilds the world from scratch. Accounts stay; everyone picks a club again.</div>
                  <div className="flex gap-2 mt-3"><input className={inputCls} placeholder="Type RESET" value={resetText} onChange={(e) => setResetText(e.target.value)} /><Button variant="destructive" disabled={resetText !== 'RESET'} loading={reset.isPending} onClick={() => reset.mutate()}>Reset</Button></div>
                </Card>
              </Section>
              <div className="t-label text-fg3 text-center pb-4">League created {w ? dateLabel(new Date().toISOString()) : ''}</div>
            </>
          );
        }}
      </Q>
      <Sheet open={!!tempPw} onClose={() => setTempPw(null)} title="Temporary password">
        {tempPw && (
          <div className="pb-2">
            <div className="t-body text-fg2">Send this to <b className="text-fg">{tempPw.user}</b>. They can change it in Settings.</div>
            <div className="t-display-sm my-3 tracking-wider">{tempPw.pw}</div>
            <Button variant="secondary" icon={<Copy size={14} />} onClick={async () => { if (await copyText(tempPw.pw)) toast('Copied', 'success'); }}>Copy</Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
