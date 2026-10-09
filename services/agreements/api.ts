import { companyFromStored, soundTemplate, templateFromStored, type AgreementKind, type AgreementTemplate, type CompanyDetails } from './template.ts';

/** The part of the Supabase client the Agreements page uses. */
export interface AgreementClient {
  from(table: 'agreement_settings' | 'driver_agreements'): any;
}

export interface AgreementSettings {
  templates: Record<AgreementKind, AgreementTemplate>;
  company: CompanyDetails;
  /** Which templates are the built-in draft (never saved). */
  builtIn: Record<AgreementKind, boolean>;
}

/** What is kept of an agreement: enough to show it again exactly as it was downloaded. */
export interface AgreementCopy {
  kind: AgreementKind;
  template: AgreementTemplate;
  values: Record<string, string>;
}

/** A saved copy as the driver's sign-in returns it (with when it was made), or null when there is none or it is broken. */
export const copyFromStored = (stored: unknown): (AgreementCopy & { createdAt: string }) | null => {
  const value = stored as { kind?: unknown; template?: unknown; values?: unknown; created_at?: unknown } | null;
  if (!value || (value.kind !== 'SEWABELI' && value.kind !== 'SEWA_BIASA') || !value.values || typeof value.values !== 'object') return null;
  const template = soundTemplate(value.template);
  if (!template) return null;
  const values = Object.fromEntries(Object.entries(value.values as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  return { kind: value.kind, template, values, createdAt: typeof value.created_at === 'string' ? value.created_at : '' };
};

type Result<T> = { data: T | null; error: { message: string } | null };
const check = <T>(result: Result<T>): T | null => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

const templateKey = (kind: AgreementKind) => `template:${kind}`;

/** Reads and saves the agreement templates and company details. Agreements themselves are never stored. */
export function agreementApi(client: AgreementClient) {
  const settings = () => client.from('agreement_settings');
  const save = async (key: string, value: unknown) => {
    check(await settings().upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
  };
  return {
    async load(): Promise<AgreementSettings> {
      const rows = check<{ key: string; value: unknown }[]>(await settings().select('key, value')) ?? [];
      const stored = new Map(rows.map(row => [row.key, row.value]));
      return {
        templates: {
          SEWA_BIASA: templateFromStored('SEWA_BIASA', stored.get(templateKey('SEWA_BIASA'))),
          SEWABELI: templateFromStored('SEWABELI', stored.get(templateKey('SEWABELI'))),
        },
        company: companyFromStored(stored.get('company')),
        builtIn: { SEWA_BIASA: !stored.has(templateKey('SEWA_BIASA')), SEWABELI: !stored.has(templateKey('SEWABELI')) },
      };
    },
    saveTemplate: (kind: AgreementKind, template: AgreementTemplate) => save(templateKey(kind), template),
    saveCompany: (company: CompanyDetails) => save('company', company),
    /** Keeps a copy of a downloaded agreement (its template and filled-in values, not the PDF) for the driver's own page. */
    async saveCopy(driverId: string, copy: AgreementCopy): Promise<void> {
      check(await client.from('driver_agreements').insert({ driver_id: driverId, kind: copy.kind, content: copy }));
    },
    /** Goes back to the built-in draft by removing the saved template. */
    async resetTemplate(kind: AgreementKind): Promise<void> {
      check(await settings().delete().eq('key', templateKey(kind)));
    },
  };
}
