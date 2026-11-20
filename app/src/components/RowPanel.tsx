import { useMemo, useState } from 'react';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldStates, SYSTEM_KEYS, type Meta } from '@engine';
import { validateWithZod } from '../lib/schema';
import { supabase, unwrap } from '../lib/supabase';
import { can, type ProjectRole } from '../lib/context';
import type { MasterKind } from '../lib/project';
import { FieldInput } from './FieldInput';
import { EvidencePanel } from './EvidencePanel';
import { SidePanel, Tabs, ErrorBox, StatusBadge, useToast } from './ui';
import { HistoryList } from './HistoryList';

type Row = Record<string, unknown>;

export function RowForm({ meta, pillar, sector, initial, masters, orgId, disabled, canEditMasters, onSubmit, submitLabel = 'Save', busy, footerExtra }: {
  meta: Meta; pillar: string; sector: string; initial: Row; masters: Record<MasterKind, Record<string, unknown>[]>; orgId: string;
  disabled: boolean; canEditMasters: boolean; onSubmit: (values: Row) => Promise<void>; submitLabel?: string; busy?: boolean; footerExtra?: React.ReactNode;
}) {
  const resolver: Resolver<Row> = async (values) => {
    const errors = validateWithZod(meta, pillar, sector, values);
    return Object.keys(errors).length
      ? { values: {}, errors: Object.fromEntries(Object.entries(errors).map(([k, m]) => [k, { type: 'validate', message: m }])) }
      : { values, errors: {} };
  };
  const form = useForm<Row>({ defaultValues: initial, resolver, mode: 'onSubmit' });
  const values = form.watch();
  const states = fieldStates(meta, pillar, sector, values);
  const groups = useMemo(() => {
    const g: { name: string; items: typeof states }[] = [];
    for (const s of states) {
      if (!s.visible) continue;
      const n = s.def.group_name ?? '';
      let grp = g.find((x) => x.name === n);
      if (!grp) { grp = { name: n, items: [] }; g.push(grp); }
      grp.items.push(s);
    }
    return g;
  }, [states]);
  const submit = form.handleSubmit(async (v) => {
    // hidden fields are kept as they are; only send data columns
    const out: Row = {};
    for (const s of states) if (v[s.key] !== undefined) out[s.key] = Number.isNaN(v[s.key]) ? null : v[s.key];
    await onSubmit(out);
  });
  return (
    <form onSubmit={submit} className="flex h-full flex-col" noValidate>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {groups.map((g) => (
          <fieldset key={g.name} className="rounded border border-gray-200 p-3">
            {g.name && <legend className="px-1 text-xs font-semibold uppercase text-gray-500">{g.name}</legend>}
            <div className="grid grid-cols-2 gap-3">
              {g.items.map((s) => (
                <div key={s.key} className={s.def.data_type === 'fk' || s.def.data_type === 'text' && s.key === 'description' ? 'col-span-2' : ''}>
                  <Controller name={s.key} control={form.control} render={({ field }) => (
                    <FieldInput state={s} value={field.value} onChange={field.onChange} disabled={disabled} lookups={meta.lookups}
                      masters={masters} orgId={orgId} canEditMasters={canEditMasters} error={form.formState.errors[s.key]?.message as string | undefined} />
                  )} />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {!disabled && (
        <div className="flex items-center justify-end gap-2 border-t bg-gray-50 px-4 py-2.5">
          {Object.keys(form.formState.errors).length > 0 && <span className="mr-auto text-xs text-red-700">Please fix the highlighted fields.</span>}
          {footerExtra}
          <button className="btn-primary" disabled={busy || form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : submitLabel}</button>
        </div>
      )}
    </form>
  );
}

export function QueriesList({ projectId, table, recordId, role }: { projectId: string; table: string; recordId: string; role: ProjectRole | string | null }) {
  const perms = can(role);
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['queries', projectId, recordId],
    queryFn: async () => unwrap(await supabase.from('dc_record_queries').select('*').eq('record_table', table).eq('record_id', recordId).order('raised_at')) as
      { id: string; body: string; status: string; raised_at: string; answer: string | null; answered_at: string | null }[],
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['queries', projectId] }); qc.invalidateQueries({ queryKey: ['rows', projectId] }); qc.invalidateQueries({ queryKey: ['dashboard', projectId] }); };
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { const r = await fn(); if (r.error) toast(r.error.message, 'error'); else refresh(); };
  return (
    <div className="space-y-3 p-4">
      {q.data?.map((x) => (
        <div key={x.id} className="rounded border p-3 text-sm">
          <div className="flex items-center gap-2"><StatusBadge s={x.status} /><span className="text-xs text-gray-500">raised {x.raised_at.slice(0, 16).replace('T', ' ')}</span></div>
          <p className="mt-1 whitespace-pre-wrap">{x.body}</p>
          {x.answer && <p className="mt-2 whitespace-pre-wrap rounded bg-blue-50 p-2"><b>Answer:</b> {x.answer}</p>}
          {x.status !== 'closed' && perms.capture && (
            <div className="mt-2 flex gap-2">
              <input className="input" placeholder="Your answer…" value={answers[x.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [x.id]: e.target.value })} />
              <button className="btn" disabled={!answers[x.id]} onClick={() => act(() => supabase.from('dc_record_queries').update({ answer: answers[x.id] }).eq('id', x.id))}>Answer</button>
            </div>
          )}
          {perms.verify && x.status !== 'closed' && <button className="btn btn-sm mt-2" onClick={() => act(() => supabase.from('dc_record_queries').update({ status: 'closed' }).eq('id', x.id))}>Close query</button>}
          {perms.verify && x.status === 'closed' && <button className="btn btn-sm mt-2" onClick={() => act(() => supabase.from('dc_record_queries').update({ status: 'open' }).eq('id', x.id))}>Reopen</button>}
        </div>
      ))}
      {q.data?.length === 0 && <p className="text-sm text-gray-500">No queries on this row.</p>}
      {perms.verify && (
        <div className="space-y-2 border-t pt-3">
          <label className="label" htmlFor="new-query">Raise a query</label>
          <textarea id="new-query" className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-primary" disabled={!body.trim()} onClick={async () => {
            const r = await supabase.rpc('dc_raise_query', { p_project: projectId, p_table: table, p_record: recordId, p_body: body });
            if (r.error) toast(r.error.message, 'error'); else { setBody(''); refresh(); }
          }}>Raise query</button>
        </div>
      )}
    </div>
  );
}

export function RowPanel({ meta, pillar, table, sector, row, project, role, locked, masters, onClose, onSaved, initialTab = 'details' }: {
  meta: Meta; pillar: string; table: string; sector: string; row: Row | null; project: { id: string; org_id: string };
  role: ProjectRole | string | null; locked: boolean; masters: Record<MasterKind, Record<string, unknown>[]>;
  onClose: () => void; onSaved: (row: Row) => void; initialTab?: 'details' | 'evidence' | 'queries' | 'history';
}) {
  const perms = can(role);
  const [tab, setTab] = useState(row ? initialTab : 'details');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = !row?.id;
  const rowLocked = !!row?.row_locked;
  const disabled = !perms.capture || ((locked || rowLocked) && !perms.manage);
  const save = async (values: Row) => {
    setErr(null);
    try {
      const res = isNew
        ? unwrap(await supabase.from(table).insert({ ...values, project_id: project.id }).select().single())
        : unwrap(await supabase.from(table).update(values).eq('id', String(row!.id)).select().single());
      qc.invalidateQueries({ queryKey: ['rows', project.id] });
      qc.invalidateQueries({ queryKey: ['dashboard', project.id] });
      toast(isNew ? 'Row added' : 'Saved');
      onSaved(res as unknown as Row);
    } catch (e) { setErr((e as Error).message); }
  };
  const initial: Row = {};
  if (row) for (const [k, v] of Object.entries(row)) if (!SYSTEM_KEYS.includes(k) && !k.startsWith('_')) initial[k] = v;
  if (isNew) {
    const crit = meta.pillars.find((p) => p.code === pillar)?.criteria_key;
    const cdef = meta.defs.find((d) => d.pillar === pillar && d.key === crit);
    if (cdef?.data_type === 'enum' && cdef.enum_values?.length) initial[cdef.key] = cdef.enum_values[0];
  }
  return (
    <SidePanel width="w-[640px]" onClose={onClose} title={<div className="flex items-center gap-2">
      {isNew ? 'New row' : 'Row details'}
      {row && <StatusBadge s={String(row.verification_status)} />}
      {rowLocked && <span className="badge bg-gray-700 text-white">Row locked</span>}
      {row?.source === 'carried_forward' && !row.confirmed && <span className="badge bg-blue-100 text-blue-800">Confirm</span>}
    </div>}>
      <div className="flex h-full flex-col">
        {!isNew && <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'details', label: 'Details' }, { id: 'evidence', label: `Evidence${row?._evidence ? ` (${row._evidence})` : ''}` },
          { id: 'queries', label: `Queries${row?._open_queries ? ` (${row._open_queries})` : ''}` }, { id: 'history', label: 'History' },
        ]} />}
        {err && <div className="px-4 pt-3"><ErrorBox error={err} /></div>}
        <div className="min-h-0 flex-1">
          {tab === 'details' && <RowForm key={String(row?.id ?? 'new')} meta={meta} pillar={pillar} sector={sector} initial={initial} masters={masters}
            orgId={project.org_id} disabled={disabled} canEditMasters={perms.capture} onSubmit={save} submitLabel={isNew ? 'Add row' : 'Save'}
            footerExtra={row?.source === 'carried_forward' && !row.confirmed && perms.capture ? (
              <button type="button" className="btn" onClick={async () => {
                const r = await supabase.rpc('dc_confirm_rows', { p_project: project.id, p_table: table, p_ids: [row.id] });
                if (r.error) toast(r.error.message, 'error'); else { qc.invalidateQueries({ queryKey: ['rows', project.id] }); qc.invalidateQueries({ queryKey: ['dashboard', project.id] }); onSaved({ ...(row as Row), confirmed: true }); }
              }}>Confirm unchanged</button>) : null} />}
          {tab === 'evidence' && row && <EvidencePanel projectId={project.id} orgId={project.org_id} pillar={pillar} recordTable={table} recordId={String(row.id)} role={role} locked={locked || rowLocked} />}
          {tab === 'queries' && row && <QueriesList projectId={project.id} table={table} recordId={String(row.id)} role={role} />}
          {tab === 'history' && row && <HistoryList projectId={project.id} table={table} recordId={String(row.id)} />}
        </div>
      </div>
    </SidePanel>
  );
}
