import { NavLink, Link } from 'react-router-dom';
import { useProject, useDashboard } from '../lib/project';
import { roleLabel, useMeta } from '../lib/context';
import { StatusBadge } from './ui';

export function ProjectHeader({ projectId }: { projectId: string }) {
  const p = useProject(projectId);
  const d = useDashboard(projectId);
  const meta = useMeta();
  const tab = ({ isActive }: { isActive: boolean }) => `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-brand font-semibold' : 'border-transparent text-gray-600 hover:text-ink'}`;
  const openQ = d.data?.pillars.reduce((a, x) => a + x.open_queries, 0) ?? 0;
  return (
    <div className="card mb-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3">
        <Link to="/" className="text-sm text-gray-500 hover:underline">Projects</Link><span className="text-gray-400">/</span>
        <h1 className="text-lg font-semibold">{p.data?.title ?? '…'}</h1>
        {p.data && <StatusBadge s={p.data.status} />}
        <span className="text-sm text-gray-600">{p.data?.organisations?.name}{p.data?.dc_org_divisions ? ` · ${p.data.dc_org_divisions.name}` : ''}</span>
        <span className="text-sm text-gray-600">{meta.data?.sectors.find((s) => s.code === p.data?.sector_code)?.name} · {p.data?.size}</span>
        <span className="text-sm text-gray-600">{p.data?.period_start} → {p.data?.period_end}</span>
        {d.data?.role && <span className="badge ml-auto bg-ink text-white">{roleLabel[d.data.role] ?? d.data.role}</span>}
      </div>
      <nav className="mt-2 flex overflow-x-auto border-t px-2">
        <NavLink end to={`/p/${projectId}`} className={tab}>Dashboard</NavLink>
        {meta.data?.pillars.map((pl) => (
          <NavLink key={pl.code} to={`/p/${projectId}/pillar/${pl.code}`} className={tab}>
            {pl.label.replace(' (Preferential Procurement)', '').replace('Enterprise & Supplier Development', 'ESD').replace('Socio-Economic Development', 'SED')}
            {d.data?.pillars.find((x) => x.pillar === pl.code)?.locked && ' 🔒'}
          </NavLink>
        ))}
        <NavLink to={`/p/${projectId}/checklist`} className={tab}>Evidence</NavLink>
        <NavLink to={`/p/${projectId}/samples`} className={tab}>Samples{openQ ? ` · ${openQ} open queries` : ''}</NavLink>
        <NavLink to={`/p/${projectId}/history`} className={tab}>History</NavLink>
      </nav>
    </div>
  );
}
