import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-gray-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand" />{label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} mt-10`}>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="font-semibold">{title}</h2>
          <button className="text-xl leading-none text-gray-500 hover:text-ink" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

export function SidePanel({ title, onClose, children, footer, width = 'w-[560px]' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" className={`flex h-full max-w-full flex-col bg-white shadow-xl ${width}`}>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="font-semibold">{title}</div>
          <button className="text-xl leading-none text-gray-500 hover:text-ink" onClick={onClose} aria-label="Close panel">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-2.5">{footer}</div>}
      </aside>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b px-3">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${value === t.id ? 'border-brand font-semibold text-ink' : 'border-transparent text-gray-500 hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- toasts
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`max-w-md rounded px-4 py-2 text-sm text-white shadow-lg ${t.kind === 'error' ? 'bg-red-700' : 'bg-ink'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- typed confirmation for destructive actions
export function ConfirmTyped({ title, message, word = 'DELETE', onConfirm, onClose, busy }: { title: string; message: ReactNode; word?: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={v !== word || busy} onClick={onConfirm}>{busy ? 'Working…' : 'Confirm'}</button>
    </>}>
      <div className="space-y-3 text-sm">
        <div>{message}</div>
        <label className="block"><span className="label">Type <b>{word}</b> to confirm</span>
          <input className="input" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>
      </div>
    </Modal>
  );
}

export const statusColors: Record<string, string> = {
  unverified: 'bg-gray-100 text-gray-600', sampled: 'bg-blue-100 text-blue-800', queried: 'bg-amber-100 text-amber-800',
  verified: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800',
  outstanding: 'bg-gray-100 text-gray-600', uploaded: 'bg-blue-100 text-blue-800', accepted: 'bg-green-100 text-green-800',
  pending: 'bg-gray-100 text-gray-600', open: 'bg-amber-100 text-amber-800', answered: 'bg-blue-100 text-blue-800', closed: 'bg-green-100 text-green-800',
  draft: 'bg-gray-100 text-gray-600', capturing: 'bg-blue-100 text-blue-800', in_verification: 'bg-amber-100 text-amber-800', archived: 'bg-gray-200 text-gray-500',
};
export function StatusBadge({ s }: { s: string }) {
  return <span className={`badge ${statusColors[s] ?? 'bg-gray-100'}`}>{s.replace(/_/g, ' ')}</span>;
}
