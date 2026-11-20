import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '../lib/supabase';
import { masterLabel, type MasterKind } from '../lib/project';
import { useMeta } from '../lib/context';
import { saIdValid } from '@engine';
import { Modal, ErrorBox } from './ui';

const TABLE: Record<MasterKind, string> = { people: 'dc_people', suppliers: 'dc_suppliers', beneficiaries: 'dc_beneficiaries', divisions: 'dc_org_divisions' };

export function MasterPicker({ kind, orgId, value, onChange, list, disabled, canEdit, id }: {
  kind: MasterKind; orgId: string; value: string | null; onChange: (id: string | null) => void;
  list: Record<string, unknown>[]; disabled?: boolean; canEdit: boolean; id?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = list.find((m) => m.id === value);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return list.filter((m) => !s || [masterLabel(kind, m), m.id_number, m.id_number_masked, m.vendor_number, m.reg_no].some((x) => x && String(x).toLowerCase().includes(s))).slice(0, 50);
  }, [q, list, kind]);
  return (
    <div className="relative" ref={box}>
      <div className="flex gap-1">
        <input id={id} className="input" disabled={disabled} value={open ? q : masterLabel(kind, current)} placeholder={`Search ${kind}…`}
          onFocus={() => { setOpen(true); setQ(''); }} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded={open} />
        {current && canEdit && kind !== 'divisions' && !disabled && <button type="button" className="btn btn-sm" onClick={() => setEdit(current)} title="Edit this record (updates it everywhere)">Edit</button>}
        {value && !disabled && <button type="button" className="btn btn-sm" aria-label="Clear" onClick={() => onChange(null)}>×</button>}
      </div>
      {open && !disabled && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded border bg-white text-sm shadow-lg">
          {filtered.map((m) => (
            <li key={String(m.id)}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-gray-100" onClick={() => { onChange(String(m.id)); setOpen(false); }}>
              {masterLabel(kind, m)}{kind === 'people' && (m.id_number || m.id_number_masked) ? <span className="ml-2 text-xs text-gray-500">{String(m.id_number ?? m.id_number_masked)}</span> : null}
            </button></li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-1.5 text-gray-500">No matches</li>}
          {canEdit && <li className="border-t"><button type="button" className="w-full px-3 py-1.5 text-left font-medium text-brand hover:bg-gray-100" onClick={() => { setEdit({}); setOpen(false); }}>+ Add new {kind === 'people' ? 'person' : kind.replace(/s$/, '').replace('beneficiarie', 'beneficiary')}{q ? ` “${q}”` : ''}</button></li>}
        </ul>
      )}
      {edit && <MasterForm kind={kind} orgId={orgId} initial={edit} seed={q} onClose={() => setEdit(null)} onSaved={(nid) => { onChange(nid); setEdit(null); }} />}
    </div>
  );
}

export function MasterForm({ kind, orgId, initial, seed, onClose, onSaved }: { kind: MasterKind; orgId: string; initial: Record<string, unknown>; seed?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const isNew = !initial.id;
  const [v, setV] = useState<Record<string, unknown>>(() => {
    if (!isNew) return { ...initial };
    if (kind === 'people' && seed) { const [a, b] = seed.split(/[ ,]+/); return { surname: a ?? '', first_name: b ?? '' }; }
    return seed ? { name: seed } : {};
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x === '' ? null : x }));
  const lk = (type: string) => meta.data?.lookups.filter((l) => l.type === type) ?? [];
  const fields: [string, string, 'text' | 'lookup' | 'bool' | 'pct' | 'enum', string?][] = kind === 'people'
    ? [['surname', 'Surname *', 'text'], ['first_name', 'First name *', 'text'], ['id_number', 'ID number', 'text'], ['race_lookup', 'Race', 'lookup', 'race'], ['gender_lookup', 'Gender', 'lookup', 'gender'], ['nationality_lookup', 'Nationality', 'lookup', 'nationality'], ['disabled', 'Disabled', 'bool'], ['disability_detail', 'Disability detail', 'text']]
    : kind === 'suppliers'
      ? [['name', 'Name *', 'text'], ['vendor_number', 'Vendor number', 'text'], ['reg_no', 'Registration no', 'text'], ['vat_no', 'VAT no', 'text'], ['contact_person', 'Contact person', 'text'], ['tel', 'Tel', 'text'], ['email', 'Email', 'text']]
      : kind === 'beneficiaries'
        ? [['name', 'Name *', 'text'], ['reg_no', 'Registration no', 'text'], ['black_owned_pct', 'Black owned %', 'pct'], ['bwo_pct', 'Black women owned %', 'pct'], ['classification', 'Classification', 'enum']]
        : [['name', 'Division name *', 'text']];
  const save = async () => {
    setErr(null);
    const req = kind === 'people' ? ['surname', 'first_name'] : ['name'];
    for (const r of req) if (!v[r]) return setErr('Please fill in the required fields.');
    if (kind === 'people' && v.id_number) {
      const fn = meta.data?.lookups.find((l) => l.id === v.nationality_lookup)?.code === 'FN';
      if (!fn && !saIdValid(String(v.id_number).replace(/\s/g, ''))) return setErr('This is not a valid South African ID number (checksum failed). Choose “Foreign National” for passports.');
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const [k] of fields) body[k] = v[k] ?? (k === 'disabled' ? false : null);
      const res = isNew
        ? unwrap(await supabase.from(TABLE[kind]).insert({ ...body, org_id: orgId }).select('id').single()) as { id: string }
        : unwrap(await supabase.from(TABLE[kind]).update(body).eq('id', String(initial.id)).select('id').single()) as { id: string };
      await qc.invalidateQueries({ queryKey: ['masters', orgId] });
      qc.invalidateQueries({ queryKey: ['rows'] });
      onSaved(res.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${isNew ? 'Add' : 'Edit'} ${kind === 'people' ? 'person' : kind.replace(/ies$/, 'y').replace(/s$/, '')}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, label, type, lt]) => (
          <label key={k} className={type === 'bool' ? 'flex items-center gap-2 pt-5 text-sm' : ''}>
            {type === 'bool' ? <><input type="checkbox" checked={!!v[k]} onChange={(e) => set(k, e.target.checked)} />{label}</> : <>
              <span className="label">{label}</span>
              {type === 'lookup' ? <select className="input" value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{lk(lt!).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
                : type === 'enum' ? <select className="input" value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{['EME', 'QSE', 'GEN'].map((x) => <option key={x}>{x}</option>)}</select>
                : <input className="input" type={type === 'pct' ? 'number' : 'text'} step="any" min={type === 'pct' ? 0 : undefined} max={type === 'pct' ? 100 : undefined}
                  value={String(v[k] ?? '')} onChange={(e) => set(k, type === 'pct' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />}
            </>}
          </label>
        ))}
      </div>
      {!isNew && <p className="mt-3 text-xs text-gray-500">Changes apply everywhere this record is used.</p>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
