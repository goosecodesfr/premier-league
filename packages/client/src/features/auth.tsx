// First-run setup, login and registration (invite-only).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Share2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { copyText } from '../lib/device';
import { Button, Chip, Field, Segmented, Select, Toggle, inputCls, useToast } from '../components/ui';
import { useStatus } from '../app/session';

function AuthFrame({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="app-column pt-safe pb-safe">
      <div className="px-6 pt-12 pb-10 max-w-[420px] mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <img src="/favicon.svg" alt="" width={44} height={44} />
          <div>
            <div className="t-caption text-fg3">Fantasy Football Manager</div>
            <div className="t-title1">{title}</div>
          </div>
        </div>
        {sub && <div className="t-body text-fg2 mb-6">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : String((error as Error).message ?? error);
  return <div className="t-label text-negative mb-4 rounded-lg bg-[color-mix(in_srgb,var(--negative)_12%,transparent)] px-3 py-2">{msg}</div>;
}

// ---------------------------------------------------------------- login
export function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const qc = useQueryClient();
  const status = useStatus();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (status.data && !status.data.setup) return <Navigate to="/setup" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { username, password });
      await qc.resetQueries();
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title="Welcome back" sub={status.data?.name ? <>Sign in to <b className="text-fg">{status.data.name}</b>.</> : undefined}>
      <form onSubmit={submit}>
        <ErrorLine error={error} />
        <Field label="Username"><input className={inputCls} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required /></Field>
        <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button full size="lg" loading={busy} type="submit">Sign in</Button>
      </form>
      <div className="mt-8 t-label text-fg2 text-center">New here? <Link to="/register" className="text-accent font-semibold">Join with an invite code</Link></div>
      <div className="mt-3 t-label text-fg3 text-center">Forgot your password? Ask your league admin to reset it.</div>
    </AuthFrame>
  );
}

// ---------------------------------------------------------------- register
export function RegisterPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const status = useStatus();
  const [invite, setInvite] = useState(params.get('code') ?? '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (status.data && !status.data.setup) return <Navigate to="/setup" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/register', { invite, username, displayName: displayName || username, password });
      await qc.resetQueries();
      nav('/onboarding/club', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title="Join the league" sub={status.data?.name ? <>You have been invited to <b className="text-fg">{status.data.name}</b>. Create your account, then pick a club.</> : 'Create your account, then pick a club.'}>
      <form onSubmit={submit}>
        <ErrorLine error={error} />
        <Field label="Invite code" hint="Your league admin shares this. It looks like ABCD-1234."><input className={`${inputCls} uppercase tracking-widest font-semibold`} value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} required autoCapitalize="characters" /></Field>
        <Field label="Username" hint="Letters, numbers, dots and dashes. You sign in with this."><input className={inputCls} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} required minLength={3} maxLength={24} /></Field>
        <Field label="Display name" hint="What your friends see, e.g. your first name."><input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} placeholder={username} /></Field>
        <Field label="Password"><input className={inputCls} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>
        <Button full size="lg" loading={busy} type="submit">Create account</Button>
      </form>
      <div className="mt-8 t-label text-fg2 text-center">Already have an account? <Link to="/login" className="text-accent font-semibold">Sign in</Link></div>
    </AuthFrame>
  );
}

// ---------------------------------------------------------------- first-run setup
const DAYS = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' }, { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
] as const;

export function SetupPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useStatus();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London', []);
  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [tz, 'Europe/London', 'Europe/Amsterdam', 'Europe/Istanbul', 'America/New_York'];
    return all.includes(tz) ? all : [tz, ...all];
  }, [tz]);
  const [step, setStep] = useState(0);
  const [key, setKey] = useState('');
  const [leagueName, setLeagueName] = useState('Friends League');
  const [timezone, setTimezone] = useState(tz);
  const [kickoffTime, setKickoffTime] = useState('20:00');
  const [leagueDays, setLeagueDays] = useState<string[]>(['tue', 'sat']);
  const [europeDay, setEuropeDay] = useState('thu');
  const [cupDay, setCupDay] = useState('sun');
  const [deadline, setDeadline] = useState(15);
  const [difficulty, setDifficulty] = useState<'casual' | 'standard' | 'competitive'>('standard');
  const [europe, setEurope] = useState(true);
  const [cups, setCups] = useState(true);
  const [noElite, setNoElite] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (status.data?.setup && !invite) nav('/login', { replace: true }); }, [status.data, invite, nav]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ invite: string }>('/setup', {
        key, leagueName, timezone, username, displayName: displayName || username, password,
        settings: { kickoffTime, leagueDays, europeDay, cupDay, deadlineMinutes: deadline, difficulty, europe, cups, clubPick: noElite ? 'no_elite' : 'free' },
      });
      setInvite(r.invite);
      await qc.resetQueries();
    } catch (e) { setError(e); if (e instanceof ApiError && e.code === 'FORBIDDEN') setStep(0); } finally { setBusy(false); }
  };

  if (invite) {
    const link = `${window.location.origin}/register?code=${invite}`;
    return (
      <AuthFrame title="Your league is live" sub="The world has been created: 20 Premier League clubs with real squads, European and Championship clubs, and bot managers already busy in the transfer market.">
        <div className="rounded-xl border border-subtle bg-surface p-4 mb-4">
          <div className="t-caption text-fg3">Invite code for your friends</div>
          <div className="t-display tracking-widest my-1">{invite}</div>
          <div className="t-label text-fg2 break-all">{link}</div>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" size="sm" icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={async () => { if (await copyText(link)) { setCopied(true); toast('Invite link copied', 'success'); } }}>Copy link</Button>
            {'share' in navigator && <Button variant="secondary" size="sm" icon={<Share2 size={16} />} onClick={() => navigator.share({ title: leagueName, text: `Join my football manager league "${leagueName}"`, url: link }).catch(() => {})}>Share</Button>}
          </div>
          <div className="t-label text-fg3 mt-3">This code works 25 times. Make more (or single-use ones) under Club → Settings → Admin.</div>
        </div>
        <Button full size="lg" onClick={() => nav('/onboarding/club', { replace: true })}>Pick your club</Button>
      </AuthFrame>
    );
  }

  if (status.data && !status.data.secretConfigured) {
    return (
      <AuthFrame title="One more step" sub="The server needs a secret before the league can be created.">
        <div className="t-body text-fg2 space-y-3">
          <p>Add an environment variable called <b className="text-fg">APP_SECRET</b> in your hosting dashboard (Vercel → Project → Settings → Environment Variables). Use a long random password.</p>
          <p>Then redeploy and reload this page. The same secret is your setup key and the password for the scheduler.</p>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create your league" sub={step === 0 ? 'You are the first one here, so you get to set things up. This takes a minute.' : undefined}>
      <ErrorLine error={error} />
      <div className="flex gap-1.5 mb-6">{[0, 1, 2].map((i) => <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? 'var(--accent)' : 'var(--bg-input)' }} />)}</div>
      {step === 0 && (
        <div>
          <Field label="Setup key" hint="The APP_SECRET value you added to your hosting environment."><div className="relative"><KeyRound size={18} className="absolute left-3 top-3.5 text-fg3" /><input className={`${inputCls} pl-10`} type="password" value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="none" /></div></Field>
          <Field label="League name"><input className={inputCls} value={leagueName} onChange={(e) => setLeagueName(e.target.value)} maxLength={40} /></Field>
          <Field label="Time zone" hint="Kick-off times and the daily schedule follow this."><Select value={timezone} onChange={setTimezone} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} /></Field>
          <Button full size="lg" disabled={!key || leagueName.trim().length < 2} onClick={() => setStep(1)}>Next</Button>
        </div>
      )}
      {step === 1 && (
        <div>
          <Field label="League match days" hint="Two a week keeps a season to about five months.">
            <div className="flex flex-wrap gap-2">{DAYS.map((d) => <Chip key={d.key} selected={leagueDays.includes(d.key)} onClick={() => setLeagueDays(leagueDays.includes(d.key) ? leagueDays.filter((x) => x !== d.key) : [...leagueDays, d.key])}>{d.label}</Chip>)}</div>
          </Field>
          <Field label="Kick-off time"><input className={inputCls} type="time" value={kickoffTime} onChange={(e) => setKickoffTime(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Europe night"><Select value={europeDay} onChange={setEuropeDay} options={DAYS.map((d) => ({ value: d.key, label: d.label }))} /></Field>
            <Field label="Cup day"><Select value={cupDay} onChange={setCupDay} options={DAYS.map((d) => ({ value: d.key, label: d.label }))} /></Field>
          </div>
          <Field label="Team sheets lock" hint="How long before kick-off lineups are frozen."><Select value={deadline} onChange={setDeadline} options={[0, 15, 30, 60, 120].map((m) => ({ value: m, label: m === 0 ? 'At kick-off' : `${m} minutes before` }))} /></Field>
          <Field label="Bot managers"><Segmented value={difficulty} onChange={setDifficulty} options={[{ value: 'casual', label: 'Relaxed' }, { value: 'standard', label: 'Standard' }, { value: 'competitive', label: 'Sharp' }]} /></Field>
          <div className="rounded-xl border border-subtle bg-surface divide-y divide-subtle mb-5">
            <label className="flex items-center justify-between px-4 h-14"><span className="t-body">European competitions</span><Toggle checked={europe} onChange={setEurope} /></label>
            <label className="flex items-center justify-between px-4 h-14"><span className="t-body">FA Cup and League Cup</span><Toggle checked={cups} onChange={setCups} /></label>
            <label className="flex items-center justify-between px-4 min-h-14 py-2 gap-3"><span><span className="t-body block">Elite clubs are bot-only</span><span className="t-label text-fg3">Humans cannot pick the top six.</span></span><Toggle checked={noElite} onChange={setNoElite} /></label>
          </div>
          <div className="flex gap-2"><Button variant="secondary" full onClick={() => setStep(0)}>Back</Button><Button full disabled={!leagueDays.length} onClick={() => setStep(2)}>Next</Button></div>
        </div>
      )}
      {step === 2 && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="t-body text-fg2 mb-4">Your own account. You will be the league admin.</div>
          <Field label="Username"><input className={inputCls} autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} required minLength={3} /></Field>
          <Field label="Display name"><input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} /></Field>
          <Field label="Password"><input className={inputCls} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>
          <div className="flex gap-2"><Button type="button" variant="secondary" full onClick={() => setStep(1)}>Back</Button><Button type="submit" full loading={busy}>Create league</Button></div>
          {busy && <div className="t-label text-fg3 mt-3 text-center">Building the world: clubs, 3,000 players, bot managers…</div>}
        </form>
      )}
    </AuthFrame>
  );
}
