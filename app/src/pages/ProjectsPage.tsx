import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp, useMeta } from '../lib/context';
import { supabase, unwrap } from '../lib/supabase';
import { Spinner, ErrorBox, StatusBadge } from '../components/ui';

export function ProjectsPage() {
  const { org, me } = useApp();
  const meta = useMeta();
  const q = useQuery({
    queryKey: ['projects', org?.id],
    enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('dc_projects')
      .select('id, title, fy_end, sector_code, size, status, data_deadline, dc_org_divisions(name)')
      .eq('org_id', org!.id).order('fy_end', { ascending: false })) as unknown as
      { id: string; title: string; fy_end: string; sector_code: string; size: string; status: string; data_deadline: string | null; dc_org_divisions: { name: string } | null }[],
  });
  const progress = useQuery({
    queryKey: ['projects-progress', org?.id, q.data?.map((p) => p.id).join()],
    enabled: !!q.data?.length,
    queryFn: async () => {
      const items = unwrap(await supabase.from('dc_evidence_checklist_items').select('project_id, status').in('project_id', q.data!.map((p) => p.id))) as { project_id: string; status: string }[];
      const out: Record<string, number> = {};
      for (const p of q.data!) {
        const mine = items.filter((i) => i.project_id === p.id);
        out[p.id] = mine.length ? Math.round((mine.filter((i) => i.status === 'accepted').length / mine.length) * 100) : 0;
      }
      return out;
    },
  });
  const canCreate = me?.is_admin || me?.is_staff || me?.orgs.some((o) => o.id === org?.id && o.role === 'consultant');
  const sectorName = (c: string) => meta.data?.sectors.find((s) => s.code === c)?.name ?? c;

  if (!org) return <div className="card p-6 text-sm text-gray-600">Choose an organisation in the header to see its projects. {me?.orgs.length === 0 && !me?.is_admin && !me?.is_staff && 'You have not been given access to any organisation yet – ask your Mantis consultant.'}</div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{org.name} – B-BBEE projects</h1>
        {canCreate && <Link to="/projects/new" className="btn-primary">+ New project</Link>}
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr>{['Project', 'Division', 'FY end', 'Sector', 'Size', 'Status', 'Data deadline', 'Evidence accepted'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="td"><Link className="font-medium text-brand hover:underline" to={`/p/${p.id}`}>{p.title}</Link></td>
                  <td className="td">{p.dc_org_divisions?.name ?? '–'}</td>
                  <td className="td">{p.fy_end}</td>
                  <td className="td">{sectorName(p.sector_code)}</td>
                  <td className="td">{p.size}</td>
                  <td className="td"><StatusBadge s={p.status} /></td>
                  <td className="td">{p.data_deadline ?? '–'}</td>
                  <td className="td w-40">
                    {progress.data?.[p.id] !== undefined ? (
                      <div className="flex items-center gap-2"><div className="h-2 flex-1 rounded bg-gray-200"><div className="h-2 rounded bg-green-600" style={{ width: `${progress.data[p.id]}%` }} /></div><span className="text-xs">{progress.data[p.id]}%</span></div>
                    ) : '…'}
                  </td>
                </tr>
              ))}
              {q.data?.length === 0 && <tr><td className="td py-6 text-center text-gray-500" colSpan={8}>No projects yet for this organisation.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
