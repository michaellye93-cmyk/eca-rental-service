import { DEFAULT_SECTIONS } from './defaults.ts';

/** The two agreement types, named as Driver.category names them. */
export type AgreementKind = 'SEWA_BIASA' | 'SEWABELI';
/**
 * How a section prints. clauses: paragraphs, one per blank-line-separated block. table: one row per line, "Label | value".
 * signature: one signature box per line, "Party | Name | ID".
 */
export type SectionLayout = 'clauses' | 'table' | 'signature';

export interface AgreementSection {
  id: string;
  title: string;
  layout: SectionLayout;
  body: string;
  /** Print straight after the previous section instead of starting a new page. */
  keepWithPrevious?: boolean;
}

export interface AgreementTemplate {
  title: string;
  /** The opening paragraph(s) under the title, naming the parties ("THIS AGREEMENT is made on ..."). */
  preamble?: string;
  sections: AgreementSection[];
}

export const KIND_LABELS: Record<AgreementKind, string> = { SEWA_BIASA: 'Sewa Biasa', SEWABELI: 'Sewa Beli' };
export const LAYOUT_LABELS: Record<SectionLayout, string> = { clauses: 'Clauses', table: 'Table (Label | value)', signature: 'Signatures (Party | Name | ID)' };

/** The company details printed on every agreement; saved once, edited on the Agreements page. */
export interface CompanyDetails {
  company_name: string;
  company_reg_no: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_bank_account: string;
  company_rep_name: string;
  company_rep_id: string;
}
export const COMPANY_FIELDS: { key: keyof CompanyDetails; label: string }[] = [
  { key: 'company_name', label: 'Company name' },
  { key: 'company_reg_no', label: 'Company registration no.' },
  { key: 'company_address', label: 'Company address' },
  { key: 'company_phone', label: 'Company phone' },
  { key: 'company_email', label: 'Company email' },
  { key: 'company_bank_account', label: 'Bank account for payments' },
  { key: 'company_rep_name', label: 'Signing on behalf of the company' },
  { key: 'company_rep_id', label: 'Their NRIC' },
];
export const emptyCompany = (): CompanyDetails => ({
  company_name: '', company_reg_no: '', company_address: '', company_phone: '', company_email: '', company_bank_account: '', company_rep_name: '', company_rep_id: '',
});

/** Everything one agreement is filled from. Dates are YYYY-MM-DD; amounts and duration are typed text. */
export interface AgreementInput {
  kind: AgreementKind;
  company: CompanyDetails;
  customer: { name: string; nric: string; phone: string; address: string };
  terms: {
    agreementDate: string;
    startDate: string;
    /** Typed end date; empty to work it out from the start date and duration. */
    endDate: string;
    cycle: 'WEEKLY' | 'MONTHLY';
    duration: string;
    rent: string;
    /** Sewa Biasa: refundable deposit (required). Sewa Beli: security deposit (optional). */
    deposit: string;
    /** Sewa Beli only, optional. */
    downpayment: string;
  };
  car: { plateNumber: string; make: string; model: string };
  details: { chassisNo: string; registeredDate: string; colour: string; ownerName: string; ownerId: string };
  /** Values for placeholders the form doesn't know, typed for this agreement only. */
  extra: Record<string, string>;
}

/** Printed where a value is missing, so it can be written in by hand. */
export const BLANK = '____________________';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoParts = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? check : null;
};
/** "9 October 2026" for a YYYY-MM-DD date; '' when not a date. */
export const longDate = (value: string): string => {
  const date = isoParts(value);
  return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : '';
};
const iso = (date: Date) => date.toISOString().slice(0, 10);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Share of the rentals that must be paid on time for the Sewa Beli ownership reward. */
export const ON_TIME_SHARE = 0.8;
const amount = (typed: string): number | null => {
  const cleaned = (typed || '').replace(/[,\sRMrm]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
};
const ringgit = (value: number | null) =>
  value === null ? '' : `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The last day of an agreement: the day before `cycles` weeks or months after the start (a month end is kept, 31 Jan + 1 month = 28 Feb). */
export const contractEndDate = (startDate: string, cycle: 'WEEKLY' | 'MONTHLY', cycles: number): string => {
  const start = isoParts(startDate);
  if (!start || !Number.isInteger(cycles) || cycles <= 0) return '';
  let next: Date;
  if (cycle === 'WEEKLY') {
    next = new Date(start.getTime() + cycles * 7 * 86_400_000);
  } else {
    const months = start.getUTCMonth() + cycles;
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), months + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(start.getUTCFullYear(), months, Math.min(start.getUTCDate(), lastDay)));
  }
  return iso(new Date(next.getTime() - 86_400_000));
};

/** Every placeholder the form fills: its label (for the "missing" list) and its value. */
const FIELDS: Record<string, { label: string; value: (input: AgreementInput) => string }> = {
  ...Object.fromEntries(COMPANY_FIELDS.map(({ key, label }) => [key, { label, value: (input: AgreementInput) => input.company[key] }])),
  customer_name: { label: 'Customer name', value: i => i.customer.name },
  customer_nric: { label: 'Customer NRIC', value: i => i.customer.nric },
  customer_phone: { label: 'Customer phone', value: i => i.customer.phone },
  customer_address: { label: 'Customer address', value: i => i.customer.address },
  agreement_type: { label: 'Agreement type', value: i => KIND_LABELS[i.kind] },
  agreement_date: { label: 'Agreement date', value: i => longDate(i.terms.agreementDate) },
  start_date: { label: 'Start date', value: i => longDate(i.terms.startDate) },
  end_date: {
    label: 'End date',
    value: i => longDate(i.terms.endDate) || longDate(contractEndDate(i.terms.startDate, i.terms.cycle, Number(i.terms.duration))),
  },
  rental_cycle: { label: 'Rent cycle', value: i => (i.terms.cycle === 'WEEKLY' ? 'week' : 'month') },
  rental_cycle_label: { label: 'Rent cycle', value: i => (i.terms.cycle === 'WEEKLY' ? 'Weekly' : 'Monthly') },
  duration: { label: 'Duration', value: i => (amount(i.terms.duration) ? String(amount(i.terms.duration)) : '') },
  duration_text: {
    label: 'Duration',
    value: i => {
      const n = amount(i.terms.duration);
      return n ? `${n} ${i.terms.cycle === 'WEEKLY' ? 'week' : 'month'}${n === 1 ? '' : 's'}` : '';
    },
  },
  payment_due: {
    label: 'Payment due day',
    value: i => {
      const start = isoParts(i.terms.startDate);
      if (!start) return '';
      if (i.terms.cycle === 'WEEKLY') return `Every ${WEEKDAYS[start.getUTCDay()]}`;
      const day = start.getUTCDate();
      // Rent falls on the month's last day when the month is shorter (the rent schedule's rule)
      return day >= 29 ? `The ${ordinal(day)} of every month (the last day in a shorter month)` : `The ${ordinal(day)} of every month`;
    },
  },
  rent_amount: { label: 'Rent amount', value: i => ringgit(amount(i.terms.rent)) },
  // Sewa Beli may take a downpayment, a security deposit, both or neither: one not taken prints "None"
  deposit_amount: { label: 'Deposit', value: i => ringgit(amount(i.terms.deposit)) || (i.kind === 'SEWABELI' ? 'None' : '') },
  downpayment_amount: { label: 'Downpayment', value: i => ringgit(amount(i.terms.downpayment)) || 'None' },
  aggregate_rental: {
    label: 'Total rent for the period',
    value: i => {
      const [rent, n] = [amount(i.terms.rent), amount(i.terms.duration)];
      return rent === null || !n ? '' : ringgit(rent * n);
    },
  },
  min_on_time_rentals: {
    label: 'On-time payments needed',
    value: i => {
      const n = amount(i.terms.duration);
      return n && Number.isInteger(n) ? String(Math.ceil(n * ON_TIME_SHARE)) : '';
    },
  },
  vehicle_plate: { label: 'Plate', value: i => i.car.plateNumber },
  vehicle_make: { label: 'Make', value: i => i.car.make },
  vehicle_model: { label: 'Model', value: i => i.car.model },
  vehicle_chassis_no: { label: 'Chassis number', value: i => i.details.chassisNo },
  vehicle_registered_date: { label: 'Registration date', value: i => longDate(i.details.registeredDate) },
  vehicle_colour: { label: 'Colour', value: i => i.details.colour },
  vehicle_owner_name: { label: 'Registered owner', value: i => i.details.ownerName },
  vehicle_owner_id: { label: "Registered owner's ID", value: i => i.details.ownerId },
};

/** Friendlier names for the extra boxes the built-in drafts ask for (typed per agreement, not stored). */
export const EXTRA_LABELS: Record<string, string> = {
  agreement_ref: 'Agreement reference no.',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_phone: 'Emergency contact phone',
  approved_driver: 'Approved other driver (or "None")',
  vehicle_location: 'Normal vehicle location',
  odometer_km: 'Odometer at handover (km)',
  fuel_level: 'Fuel level at handover',
  witness_name: 'Witness name',
  witness_id: "Witness's NRIC",
};

/** The label for any placeholder: the form's, a friendly extra name, or the key in words. */
export const fieldLabel = (key: string): string =>
  FIELDS[key]?.label ?? EXTRA_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** The placeholders a template may use, for the editor's list. */
export const PLACEHOLDERS: { key: string; label: string }[] = Object.entries(FIELDS).map(([key, { label }]) => ({ key, label }));

/** Every placeholder's value for this agreement (empty when not filled), plus the extra fields typed for it. */
export const agreementValues = (input: AgreementInput): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(input.extra).map(([key, value]) => [key, value.trim()])),
  ...Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, (field.value(input) || '').trim()])),
});

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** The placeholders in a text, each once, in order. */
export const placeholdersIn = (text: string): string[] => [...new Set([...text.matchAll(PLACEHOLDER)].map(match => match[1]))];

/** The text with every {{placeholder}} replaced; a missing or empty value prints as a blank line to write on. */
export const fillText = (text: string, values: Record<string, string>): string =>
  text.replace(PLACEHOLDER, (_, key: string) => values[key] || BLANK);

const templatePlaceholders = (template: AgreementTemplate) =>
  [...new Set([template.preamble ?? '', ...template.sections.map(section => `${section.title}\n${section.body}`)].flatMap(placeholdersIn))];

/** Placeholders the form doesn't fill: the generator asks for them as extra fields. */
export const extraPlaceholders = (template: AgreementTemplate): string[] =>
  templatePlaceholders(template).filter(key => !Object.hasOwn(FIELDS, key));

/** Labels of the template's form fields that are still empty for this agreement (extra fields by their name). */
export const missingFields = (template: AgreementTemplate, input: AgreementInput): string[] => {
  const values = agreementValues(input);
  return [...new Set(templatePlaceholders(template).filter(key => !values[key]).map(fieldLabel))];
};

/** "SECTION A - SCHEDULE": sections are lettered by their place, so reordering relabels them. */
export const sectionHeading = (index: number, title: string): string =>
  `SECTION ${String.fromCharCode(65 + index)} - ${title.trim().toUpperCase()}`;

/** Every section but the first starts on a new page, unless it is set to follow on from the one before. */
export const startsNewPage = (section: AgreementSection, index: number): boolean => index > 0 && !section.keepWithPrevious;

/** A table or signature body as rows of cells, split on "|"; blank lines dropped. */
export const parseRows = (body: string): string[][] =>
  body.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.split('|').map(cell => cell.trim()));

/** A clause paragraph written all in capitals (e.g. "2. RENT AND PAYMENT") is a heading and prints in bold. */
export const isClauseHeading = (paragraph: string): boolean => /[A-Z]/.test(paragraph) && paragraph === paragraph.toUpperCase() && paragraph.length <= 80;

/** A clauses body as paragraphs (blocks separated by a blank line). */
export const parseParagraphs = (body: string): string[] =>
  body.split(/\r?\n\s*\r?\n/).map(block => block.trim()).filter(Boolean);

/** The built-in draft for a type: a fresh copy, safe to edit. */
export const defaultTemplate = (kind: AgreementKind): AgreementTemplate => ({
  title: DEFAULT_SECTIONS[kind].title,
  preamble: DEFAULT_SECTIONS[kind].preamble,
  sections: DEFAULT_SECTIONS[kind].sections.map(section => ({ ...section })),
});

const isLayout = (value: unknown): value is SectionLayout => value === 'clauses' || value === 'table' || value === 'signature';

/** A saved template when it has the right shape, else the built-in draft. */
export const templateFromStored = (kind: AgreementKind, stored: unknown): AgreementTemplate => {
  const value = stored as { title?: unknown; preamble?: unknown; sections?: unknown } | null;
  if (!value || typeof value.title !== 'string' || !Array.isArray(value.sections)) return defaultTemplate(kind);
  const sections = value.sections.filter((s): s is AgreementSection =>
    !!s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.body === 'string' && isLayout(s.layout)
    && (s.keepWithPrevious === undefined || typeof s.keepWithPrevious === 'boolean'));
  if (sections.length !== value.sections.length) return defaultTemplate(kind);
  return typeof value.preamble === 'string' ? { title: value.title, preamble: value.preamble, sections } : { title: value.title, sections };
};

/** Saved company details, with any missing field empty. */
export const companyFromStored = (stored: unknown): CompanyDetails => {
  const value = (stored ?? {}) as Record<string, unknown>;
  const company = emptyCompany();
  for (const { key } of COMPANY_FIELDS) if (typeof value[key] === 'string') company[key] = value[key] as string;
  return company;
};
