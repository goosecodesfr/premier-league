// Tactic list: up to five saved tactics with shape glyph, mentality, familiarity and record.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { FORMATIONS, FORMATION_KEYS, MENTALITY_LABELS, type Tactic } from '@ffm/engine';
import type { TacticOut } from '@ffm/server/routes/tactics';
import { api } from '../../lib/api';
import { Badge, Button, Card, IconButton, List, ListRow, Meter, Q, Screen, Sheet, SkeletonCards, inputCls, useConfirm, useToast } from '../../components/ui';

export function ShapeGlyph({ slots, size = 56 }: { slots: { x: number; y: number }[]; size?: number }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 100 125" aria-hidden className="shrink-0 rounded-md" style={{ background: '#12201a' }}>
      <rect x={4} y={4} width={92} height={117} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2} rx={3} />
      <line x1={4} y1={62.5} x2={96} y2={62.5} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
      {slots.map((s, i) => <circle key={i} cx={4 + (s.x / 100) * 92} cy={121 - (s.y / 100) * 110} r={6} fill={i === 0 ? '#F5A524' : 'var(--accent)'} />)}
    </svg>
  );
}

export function TacticList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['tactics'], queryFn: () => api.get<{ tactics: TacticOut[]; max: number }>('/tactics') });
  const [menu, setMenu] = useState<TacticOut | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<TacticOut | null>(null);
  const [name, setName] = useState('');
  const inv = () => qc.invalidateQueries({ queryKey: ['tactics'] });
  const create = useMutation({
    mutationFn: (b: { formation?: string; from?: number; name?: string }) => api.post<{ tactic: TacticOut }>('/tactics', b),
    onSuccess: (r) => { inv(); setCreating(false); nav(`/tactics/${r.tactic.id}`); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const setDefault = useMutation({ mutationFn: (id: number) => api.post(`/tactics/${id}/default`), onSuccess: () => { inv(); toast('Default tactic changed', 'success'); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/tactics/${id}`), onSuccess: () => { inv(); toast('Tactic deleted', 'success'); }, onError: (e: Error) => toast(e.message, 'error') });
  const rename = useMutation({ mutationFn: (x: { id: number; name: string }) => api.put(`/tactics/${x.id}`, { name: x.name }), onSuccess: () => { inv(); setRenaming(null); }, onError: (e: Error) => toast(e.message, 'error') });
  const full = (q.data?.tactics.length ?? 0) >= (q.data?.max ?? 5);
  return (
    <Screen title="Tactics" actions={<IconButton label="New tactic" disabled={full} onClick={() => setCreating(true)}><Plus size={22} /></IconButton>}>
      <Q q={q} skeleton={<SkeletonCards n={3} h={96} />}>
        {(d) => (
          <div className="space-y-3">
            {d.tactics.map((t) => (
              <Card key={t.id} to={`/tactics/${t.id}`} className="flex items-center gap-4">
                <ShapeGlyph slots={t.data.slots} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="t-strong truncate">{t.name}</span>{t.isDefault && <Badge tone="accent">Default</Badge>}</div>
                  <div className="t-label text-fg2">{t.formation} · {MENTALITY_LABELS[String(t.mentality)]}</div>
                  <div className="flex items-center gap-2 mt-2"><Meter value={t.familiarity * 100} className="flex-1" tone={t.familiarity >= 0.8 ? 'positive' : t.familiarity >= 0.6 ? 'warning' : 'negative'} /><span className="t-label text-fg3 tabular w-9 text-right">{Math.round(t.familiarity * 100)}%</span></div>
                  <div className="t-label text-fg3 mt-1 tabular">P{t.record.p} W{t.record.w} D{t.record.d} L{t.record.l}</div>
                </div>
                <IconButton label="Tactic options" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(t); }}><MoreHorizontal size={20} /></IconButton>
              </Card>
            ))}
            {!full && (
              <button type="button" onClick={() => setCreating(true)} className="w-full h-20 rounded-[12px] border-2 border-dashed border-subtle text-fg2 t-strong flex items-center justify-center gap-2 active:bg-surface"><Plus size={18} /> New tactic</button>
            )}
            <div className="t-label text-fg3 pt-2">Familiarity grows as you play and train a shape. Big changes to a tactic cost familiarity; the default tactic is also what your assistant uses if you miss a deadline.</div>
          </div>
        )}
      </Q>
      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name}>
        {menu && (
          <List>
            {!menu.isDefault && <ListRow icon={<Star size={18} />} title="Make default" onClick={() => { setDefault.mutate(menu.id); setMenu(null); }} />}
            <ListRow icon={<Pencil size={18} />} title="Rename" onClick={() => { setName(menu.name); setRenaming(menu); setMenu(null); }} />
            <ListRow icon={<Copy size={18} />} title="Duplicate" onClick={() => { if (full) toast('You already have five tactics', 'error'); else create.mutate({ from: menu.id }); setMenu(null); }} />
            {!menu.isDefault && <ListRow icon={<Trash2 size={18} className="text-negative" />} title={<span className="text-negative">Delete</span>} onClick={async () => { const m = menu; setMenu(null); if (await confirm({ title: `Delete ${m.name}?`, body: 'Its familiarity and record go with it.', confirm: 'Delete', destructive: true })) del.mutate(m.id); }} />}
          </List>
        )}
      </Sheet>
      <Sheet open={!!renaming} onClose={() => setRenaming(null)} title="Rename tactic" footer={<Button full loading={rename.isPending} onClick={() => renaming && rename.mutate({ id: renaming.id, name })}>Save</Button>}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoFocus />
      </Sheet>
      <Sheet open={creating} onClose={() => setCreating(false)} title="Pick a shape">
        <div className="grid grid-cols-3 gap-2 pb-2">
          {FORMATION_KEYS.map((f) => (
            <button key={f} type="button" disabled={create.isPending} onClick={() => create.mutate({ formation: f })} className="rounded-xl border border-subtle bg-raised p-2 flex flex-col items-center gap-1.5 active:brightness-110">
              <ShapeGlyph slots={FORMATIONS[f]} size={64} />
              <span className="t-strong">{f}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </Screen>
  );
}

export type { Tactic };
