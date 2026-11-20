import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from './supabase';
import type { ProjectRole } from './context';

export interface Project {
  id: string; org_id: string; division_id: string | null; product_id: string; sector_code: string; size: string; title: string;
  fy_end: string; period_start: string; period_end: string; status: string; data_deadline: string | null; verification_date: string | null;
  description: string | null; previous_project_id: string | null; created_at: string;
}
export interface PillarCard {
  pillar: string; label: string; table: string; mode: 'single' | 'list'; rows: number; rows_missing_required: number;
  unconfirmed: number; sampled: number; locked: boolean; evidence_outstanding: number; evidence_total: number; open_queries: number;
}
export interface Dashboard { role: ProjectRole; pillars: PillarCard[]; checklist: { total: number; accepted: number; outstanding: number } }

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId],
    enabled: !!projectId,
    queryFn: async () => unwrap(await supabase.from('dc_projects').select('*, organisations(name), dc_org_divisions(name)').eq('id', projectId!).single()) as Project & { organisations: { name: string }; dc_org_divisions: { name: string } | null },
  });
}

export function useDashboard(projectId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', projectId],
    enabled: !!projectId,
    queryFn: async () => unwrap(await supabase.rpc('dc_project_dashboard', { p_project: projectId })) as Dashboard,
  });
}

export type MasterKind = 'people' | 'suppliers' | 'beneficiaries' | 'divisions';
export interface Person { [k: string]: unknown; id: string; org_id: string; surname: string; first_name: string; id_number?: string | null; id_number_masked?: string | null; race_lookup: string | null; gender_lookup: string | null; nationality_lookup: string | null; disabled: boolean; disability_detail?: string | null }

/** Masters for an organisation. Viewers get people from the masked view. */
export function useMasters(orgId: string | undefined, fullAccess: boolean) {
  return useQuery({
    queryKey: ['masters', orgId, fullAccess],
    enabled: !!orgId,
    queryFn: async () => {
      const page = async (table: string, cols: string) => {
        const out: Record<string, unknown>[] = [];
        for (let from = 0; ; from += 1000) {
          const r = unwrap(await supabase.from(table).select(cols).eq('org_id', orgId!).order(table === 'dc_people' || table === 'dc_v_people_masked' ? 'surname' : 'name').range(from, from + 999)) as unknown as Record<string, unknown>[];
          out.push(...r);
          if (r.length < 1000) break;
        }
        return out;
      };
      const [people, suppliers, beneficiaries, divisions] = await Promise.all([
        fullAccess ? page('dc_people', '*') : page('dc_v_people_masked', '*'),
        fullAccess ? page('dc_suppliers', '*') : Promise.resolve([]),
        fullAccess ? page('dc_beneficiaries', '*') : Promise.resolve([]),
        page('dc_org_divisions', '*'),
      ]);
      return { people: people as unknown as Person[], suppliers, beneficiaries, divisions } as {
        people: Person[]; suppliers: Record<string, unknown>[]; beneficiaries: Record<string, unknown>[]; divisions: Record<string, unknown>[];
      };
    },
  });
}

export const masterLabel = (kind: MasterKind, m: Record<string, unknown> | undefined): string => {
  if (!m) return '';
  if (kind === 'people') return `${m.surname}, ${m.first_name}`;
  if (kind === 'suppliers') return `${m.name}${m.vendor_number ? ` (${m.vendor_number})` : ''}`;
  return String(m.name ?? '');
};
