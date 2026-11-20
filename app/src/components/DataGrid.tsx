import { useMemo, useRef, useState } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender,
  type ColumnDef, type SortingState, type ColumnFiltersState, type VisibilityState, type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatMoney, formatNumber, lookupMap, type Meta, type FieldDef } from '@engine';
import type { MasterKind } from '../lib/project';
import { StatusBadge, Modal } from './ui';

type Row = Record<string, unknown>;
export interface GridActions { onOpen: (row: Row, tab?: 'details' | 'evidence' | 'queries' | 'history') => void; onDelete?: (row: Row) => void }

const MASTER_COLS: Record<MasterKind, { key: string; label: string }[]> = {
  people: [{ key: 'surname', label: 'Surname' }, { key: 'first_name', label: 'First name' }, { key: 'id_number', label: 'ID number' }, { key: 'race', label: 'Race' }, { key: 'gender', label: 'Gender' }, { key: 'nationality', label: 'Nationality' }, { key: 'disabled', label: 'Disabled' }],
  suppliers: [{ key: 'name', label: 'Supplier' }, { key: 'vendor_number', label: 'Vendor no' }, { key: 'reg_no', label: 'Reg no' }, { key: 'vat_no', label: 'VAT no' }, { key: 'contact_person', label: 'Contact' }, { key: 'tel', label: 'Tel' }, { key: 'email', label: 'Email' }],
  beneficiaries: [{ key: 'name', label: 'Beneficiary' }],
  divisions: [{ key: 'name', label: 'Division' }],
};

function display(def: FieldDef, v: unknown, lk: Map<string, { label: string }>): string {
  if (v === null || v === undefined || v === '') return '';
  switch (def.data_type) {
    case 'money': case 'money_signed': return formatMoney(v);
    case 'percent': return `${formatNumber(v, 4)}%`;
    case 'integer': case 'numeric': return formatNumber(v, 4);
    case 'boolean': return v ? 'Yes' : 'No';
    case 'lookup': return lk.get(String(v))?.label ?? '';
    case 'enum': { const i = (def.enum_values ?? []).indexOf(String(v)); return i >= 0 ? def.enum_labels?.[i] ?? String(v) : String(v); }
    default: return String(v);
  }
}

export function DataGrid({ meta, pillar, rows, masters, storageKey, actions, selection, onSelection, canSelect, canDelete, height = 'calc(100vh - 300px)' }: {
  meta: Meta; pillar: string; rows: Row[]; masters: Record<MasterKind, Record<string, unknown>[]>; storageKey: string;
  actions: GridActions; selection: RowSelectionState; onSelection: (s: RowSelectionState) => void; canSelect: boolean; canDelete: boolean; height?: string;
}) {
  const lk = useMemo(() => lookupMap(meta.lookups), [meta.lookups]);
  const masterMaps = useMemo(() => Object.fromEntries(Object.entries(masters).map(([k, list]) => [k, new Map(list.map((m) => [String(m.id), m]))])) as Record<MasterKind, Map<string, Row>>, [masters]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [chooser, setChooser] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityState>(() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}'); } catch { return {}; } });
  const saveVisibility = (v: VisibilityState) => { setVisibility(v); try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch { /* ignore */ } };

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const defs = meta.defs.filter((d) => d.pillar === pillar && d.grid_visible !== false).sort((a, b) => a.sort - b.sort);
    const leaf: { group: string; col: ColumnDef<Row> }[] = [];
    for (const d of defs) {
      if (d.data_type === 'fk' && d.fk_target) {
        const t = d.fk_target as MasterKind;
        for (const mc of MASTER_COLS[t]) {
          leaf.push({
            group: d.label,
            col: {
              id: `${d.key}.${mc.key}`, header: mc.label,
              accessorFn: (r) => {
                const m = r[d.key] ? masterMaps[t].get(String(r[d.key])) : undefined;
                if (!m) return '';
                if (mc.key === 'id_number') return String(m.id_number ?? m.id_number_masked ?? '');
                if (['race', 'gender', 'nationality'].includes(mc.key)) return lk.get(String(m[`${mc.key}_lookup`]))?.label ?? '';
                if (mc.key === 'disabled') return m.disabled ? 'Yes' : 'No';
                return String(m[mc.key] ?? '');
              },
            },
          });
        }
      } else {
        const numeric = ['money', 'money_signed', 'percent', 'integer', 'numeric'].includes(d.data_type);
        leaf.push({
          group: d.group_name ?? '',
          col: {
            id: d.key, header: d.label,
            accessorFn: (r) => (numeric ? (r[d.key] === null || r[d.key] === undefined ? null : Number(r[d.key])) : display(d, r[d.key], lk)),
            cell: (c) => <span className={numeric ? 'block text-right tabular-nums' : ''}>{display(d, c.row.original[d.key], lk)}</span>,
            sortUndefined: 'last',
            filterFn: (row, id, val) => display(d, row.original[d.key], lk).toLowerCase().includes(String(val).toLowerCase()),
          },
        });
      }
    }
    if (pillar === 'esd') leaf.push({ group: 'Early payment', col: { id: 'days_to_pay', header: 'Days to pay', accessorFn: (r) => r.days_to_pay ?? null } });
    // collapse consecutive leaves with the same group into header groups
    const grouped: ColumnDef<Row>[] = [];
    let cur: { header: string; columns: ColumnDef<Row>[] } | null = null;
    for (const l of leaf) {
      if (!cur || cur.header !== l.group) { cur = { header: l.group, columns: [] }; grouped.push({ id: `g-${grouped.length}-${l.group}`, header: l.group, columns: cur.columns } as ColumnDef<Row>); }
      cur.columns.push(l.col);
    }
    const status: ColumnDef<Row> = {
      id: 'g-status', header: 'Verification', columns: [
        { id: 'verification_status', header: 'Status', accessorFn: (r) => String(r.verification_status), cell: (c) => <StatusBadge s={String(c.getValue())} /> },
        { id: '_open_queries', header: 'Queries', accessorFn: (r) => Number(r._open_queries ?? 0), cell: (c) => c.getValue() ? <button className="badge bg-amber-100 text-amber-800" onClick={() => actions.onOpen(c.row.original, 'queries')}>{String(c.getValue())} open</button> : '' },
        { id: '_evidence', header: 'Evidence', accessorFn: (r) => Number(r._evidence ?? 0), cell: (c) => <button className="text-xs text-brand underline" onClick={() => actions.onOpen(c.row.original, 'evidence')}>{String(c.getValue() || 'add')}</button> },
        { id: 'source', header: 'Source', accessorFn: (r) => String(r.source), cell: (c) => c.row.original.source === 'carried_forward' && !c.row.original.confirmed ? <span className="badge bg-blue-100 text-blue-800">confirm</span> : <span className="text-xs text-gray-500">{String(c.getValue()).replace('_', ' ')}</span> },
      ],
    };
    const select: ColumnDef<Row> = {
      id: '_select', enableHiding: false, enableSorting: false,
      header: ({ table }) => canSelect ? <input type="checkbox" aria-label="Select all" checked={table.getIsAllRowsSelected()} ref={(el) => { if (el) el.indeterminate = table.getIsSomeRowsSelected(); }} onChange={table.getToggleAllRowsSelectedHandler()} /> : null,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canSelect && <input type="checkbox" aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />}
          <button className="text-xs text-brand underline" onClick={() => actions.onOpen(row.original)}>Open</button>
          {canDelete && actions.onDelete && !row.original.row_locked && <button className="text-xs text-gray-500 hover:text-red-700" aria-label="Delete row" onClick={() => actions.onDelete!(row.original)}>✕</button>}
          {!!row.original.row_locked && <span title="Row locked">🔒</span>}
        </div>
      ),
    };
    return [select, ...grouped, status];
  }, [meta, pillar, lk, masterMaps, actions, canSelect, canDelete]);

  const table = useReactTable({
    data: rows, columns, getRowId: (r) => String(r.id),
    state: { sorting, columnFilters: filters, globalFilter, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: setSorting, onColumnFiltersChange: setFilters, onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: (u) => saveVisibility(typeof u === 'function' ? u(visibility) : u),
    onRowSelectionChange: (u) => onSelection(typeof u === 'function' ? u(selection) : u),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _id, val) => {
      const s = String(val).toLowerCase();
      return row.getAllCells().some((c) => { const v = c.getValue(); return v !== null && v !== undefined && String(v).toLowerCase().includes(s); });
    },
  });

  const scroller = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const virt = useVirtualizer({ count: tableRows.length, getScrollElement: () => scroller.current, estimateSize: () => 31, overscan: 20 });
  const items = virt.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;
  const leafCount = table.getVisibleLeafColumns().length;

  return (
    <div className="card flex flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <input className="input max-w-xs" placeholder="Search all columns…" value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} aria-label="Search" />
        <span className="text-xs text-gray-500">{tableRows.length} of {rows.length} rows{Object.keys(selection).length ? ` · ${Object.keys(selection).length} selected` : ''}</span>
        {filters.length > 0 && <button className="btn btn-sm" onClick={() => setFilters([])}>Clear column filters</button>}
        <button className="btn btn-sm ml-auto" onClick={() => setChooser(true)}>Columns</button>
      </div>
      <div ref={scroller} className="overflow-auto" style={{ maxHeight: height }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20">
            {table.getHeaderGroups().map((hg, hi) => (
              <tr key={hg.id}>
                {hg.headers.map((h, ci) => (
                  <th key={h.id} colSpan={h.colSpan}
                    className={`th whitespace-nowrap ${hi === 0 ? 'bg-gray-200 text-center text-xxs uppercase' : ''} ${ci <= 1 ? 'sticky z-10' : ''}`}
                    style={ci <= 1 ? { left: ci === 0 ? 0 : 92 } : undefined}>
                    {h.isPlaceholder ? null : h.column.getCanSort() && h.subHeaders.length === 0 ? (
                      <button className="flex items-center gap-1 font-semibold" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}{({ asc: '▲', desc: '▼' } as Record<string, string>)[h.column.getIsSorted() as string] ?? ''}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
            <tr>
              {table.getVisibleLeafColumns().map((c, ci) => (
                <th key={c.id} className={`border-b bg-white px-1 py-0.5 ${ci <= 1 ? 'sticky z-10' : ''}`} style={ci <= 1 ? { left: ci === 0 ? 0 : 92 } : undefined}>
                  {c.getCanFilter() && c.id !== '_select' ? <input className="w-full min-w-[60px] rounded border border-gray-200 px-1 py-0.5 text-xs font-normal" aria-label={`Filter ${c.id}`}
                    value={(c.getFilterValue() as string) ?? ''} onChange={(e) => c.setFilterValue(e.target.value || undefined)} /> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && <tr><td colSpan={leafCount} style={{ height: padTop }} /></tr>}
            {items.map((vi) => {
              const r = tableRows[vi.index];
              return (
                <tr key={r.id} className={`${r.getIsSelected() ? 'bg-brand-light' : vi.index % 2 ? 'bg-gray-50/60' : 'bg-white'} hover:bg-yellow-50`} onDoubleClick={() => actions.onOpen(r.original)}>
                  {r.getVisibleCells().map((c, ci) => (
                    <td key={c.id} className={`td whitespace-nowrap ${ci <= 1 ? 'sticky z-[5] bg-inherit' : ''} ${ci === 1 ? 'border-r font-medium' : ''}`}
                      style={ci <= 1 ? { left: ci === 0 ? 0 : 92, minWidth: ci === 0 ? 92 : undefined, background: 'inherit' } : undefined}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {padBottom > 0 && <tr><td colSpan={leafCount} style={{ height: padBottom }} /></tr>}
            {tableRows.length === 0 && <tr><td colSpan={leafCount} className="td py-8 text-center text-gray-500">No rows.</td></tr>}
          </tbody>
        </table>
      </div>
      {chooser && (
        <Modal title="Choose columns" onClose={() => setChooser(false)} footer={<>
          <button className="btn" onClick={() => saveVisibility({})}>Show all</button>
          <button className="btn-primary" onClick={() => setChooser(false)}>Done</button></>}>
          <div className="grid max-h-[60vh] grid-cols-2 gap-1 overflow-y-auto text-sm">
            {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
              <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                {typeof c.columnDef.header === 'string' ? `${c.parent && typeof c.parent.columnDef.header === 'string' && c.parent.columnDef.header ? c.parent.columnDef.header + ' › ' : ''}${c.columnDef.header}` : c.id}</label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
