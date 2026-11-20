import { z } from 'zod';
import { fieldStates, validateRow, type Meta, type FieldState, type FieldDef } from '@engine';

/** Zod type for one field, built from its metadata. */
export function zodFor(def: FieldDef, label: string, required: boolean): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  const msg = `${label} is required`;
  switch (def.data_type) {
    case 'money': case 'numeric': case 'percent': case 'integer': {
      let n = z.number({ invalid_type_error: `${label} must be a number`, required_error: msg });
      n = n.min(0, `${label} cannot be negative`);
      if (def.data_type === 'percent') n = n.max(100, `${label} must be between 0 and 100`);
      if (def.data_type === 'integer') n = n.int(`${label} must be a whole number`);
      if (def.min_value !== null && def.min_value !== undefined) n = n.min(def.min_value, `${label} must be at least ${def.min_value}`);
      if (def.max_value !== null && def.max_value !== undefined) n = n.max(def.max_value, `${label} must be at most ${def.max_value}`);
      t = n; break;
    }
    case 'money_signed': t = z.number({ invalid_type_error: `${label} must be a number`, required_error: msg }); break;
    case 'boolean': return z.boolean().optional();
    case 'date': t = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`); break;
    case 'enum': t = z.enum((def.enum_values ?? ['']) as [string, ...string[]], { errorMap: () => ({ message: required ? msg : `${label}: choose an option` }) }); break;
    default: t = z.string({ required_error: msg }).min(1, msg);
  }
  // required fields: a clear "is required" message for empty values, then the type checks
  return required
    ? z.any().refine((v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v)) || typeof v === 'number', msg).pipe(t)
    : t.nullable().optional();
}

/** Schema for a whole row in its current state (visibility rules applied) + cross-field checks. */
export function rowSchema(meta: Meta, pillar: string, sector: string, values: Record<string, unknown>) {
  const states = fieldStates(meta, pillar, sector, values);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const s of states) shape[s.key] = s.visible ? zodFor(s.def, s.label, s.required) : z.any();
  return z.object(shape).passthrough().superRefine((v, ctx) => {
    for (const e of validateRow(meta, pillar, sector, v)) {
      if (['bw_pct', 'end_date', 'payment_date', 'learning_category'].includes(e.column)) ctx.addIssue({ code: 'custom', path: [e.column], message: e.message });
    }
  });
}

export function validateWithZod(meta: Meta, pillar: string, sector: string, values: Record<string, unknown>): Record<string, string> {
  const r = rowSchema(meta, pillar, sector, values).safeParse(values);
  const out: Record<string, string> = {};
  if (!r.success) for (const i of r.error.issues) { const k = String(i.path[0]); if (!out[k]) out[k] = i.message; }
  return out;
}

export type { FieldState };
