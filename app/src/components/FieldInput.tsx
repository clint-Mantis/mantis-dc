import { useEffect, useState } from 'react';
import { parseNumber, formatNumber, type FieldState, type Lookup } from '@engine';
import { MasterPicker } from './MasterPicker';
import type { MasterKind } from '../lib/project';

/** One form control driven by field metadata. Numbers are typed with SA formatting tolerated ("1 234,56"). */
export function FieldInput({ state, value, onChange, disabled, lookups, masters, orgId, canEditMasters, error }: {
  state: FieldState; value: unknown; onChange: (v: unknown) => void; disabled: boolean; lookups: Lookup[];
  masters: Record<MasterKind, Record<string, unknown>[]>; orgId: string; canEditMasters: boolean; error?: string;
}) {
  const d = state.def;
  const id = `f-${d.pillar}-${d.key}`;
  const labelEl = (
    <label htmlFor={id} className="label">
      {state.label}{state.required && <span className="text-brand"> *</span>}
      {d.help && <span className="ml-1 font-normal text-gray-400" title={d.help}>ⓘ</span>}
    </label>
  );
  let control: JSX.Element;
  if (d.data_type === 'boolean') {
    return (
      <div className="flex items-center gap-2 pt-4">
        <input id={id} type="checkbox" className="h-4 w-4 accent-brand" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id} className="text-sm">{state.label}</label>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    );
  } else if (d.data_type === 'lookup') {
    const opts = lookups.filter((l) => l.type === d.lookup_type && (l.active !== false || l.id === value));
    control = (
      <select id={id} className="input" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    );
  } else if (d.data_type === 'enum') {
    control = (
      <select id={id} className="input" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(d.enum_values ?? []).map((v, i) => <option key={v} value={v}>{d.enum_labels?.[i] ?? v}</option>)}
      </select>
    );
  } else if (d.data_type === 'fk') {
    control = <MasterPicker id={id} kind={d.fk_target as MasterKind} orgId={orgId} value={(value as string) ?? null} onChange={onChange}
      list={masters[d.fk_target as MasterKind] ?? []} disabled={disabled} canEdit={canEditMasters} />;
  } else if (d.data_type === 'date') {
    control = <input id={id} type="date" className="input" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />;
  } else if (d.data_type === 'text') {
    control = <input id={id} className="input" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />;
  } else {
    control = <NumberInput id={id} value={value as number | null} onChange={onChange} disabled={disabled} money={d.data_type.startsWith('money')} percent={d.data_type === 'percent'} />;
  }
  return (
    <div>
      {labelEl}
      {control}
      {error && <div className="mt-0.5 text-xs text-red-700" role="alert">{error}</div>}
    </div>
  );
}

function NumberInput({ id, value, onChange, disabled, money, percent }: { id: string; value: number | null; onChange: (v: unknown) => void; disabled: boolean; money: boolean; percent: boolean }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : formatNumber(value, money ? 2 : 4));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value === null || value === undefined ? '' : formatNumber(value, money ? 2 : 4)); }, [value, focus, money]);
  return (
    <div className="relative">
      {money && <span className="pointer-events-none absolute left-2 top-1.5 text-sm text-gray-400">R</span>}
      <input id={id} inputMode="decimal" className={`input text-right ${money ? 'pl-6' : ''} ${percent ? 'pr-6' : ''}`} disabled={disabled} value={text}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); const n = parseNumber(text); onChange(n === null ? null : Number.isNaN(n) ? NaN : n); }}
        onChange={(e) => { setText(e.target.value); const n = parseNumber(e.target.value); onChange(n === null ? null : Number.isNaN(n) ? NaN : n); }} />
      {percent && <span className="pointer-events-none absolute right-2 top-1.5 text-sm text-gray-400">%</span>}
    </div>
  );
}
