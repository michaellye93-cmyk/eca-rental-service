import { companyFromStored, templateFromStored, type AgreementKind, type AgreementTemplate, type CompanyDetails } from './template.ts';

/** The part of the Supabase client the Agreements page uses. */
export interface AgreementClient {
  from(table: 'agreement_settings'): any;
}

export interface AgreementSettings {
  templates: Record<AgreementKind, AgreementTemplate>;
  company: CompanyDetails;
  /** Which templates are the built-in draft (never saved). */
  builtIn: Record<AgreementKind, boolean>;
}

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
    /** Goes back to the built-in draft by removing the saved template. */
    async resetTemplate(kind: AgreementKind): Promise<void> {
      check(await settings().delete().eq('key', templateKey(kind)));
    },
  };
}
