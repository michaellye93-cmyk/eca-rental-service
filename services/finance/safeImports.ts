export interface SafeWorkbookRow {
  source_row: number;
  sheet_name: string;
  values: Record<string, unknown>;
}

export interface SafeWorkbookSheet {
  name: string;
  headers: string[];
  rows: SafeWorkbookRow[];
}

export type SafeImportDestination =
  | 'vehicle_master'
  | 'vehicle_monthly_costs'
  | 'insurance'
  | 'fixed_cost'
  | 'company_expenses'
  | 'workshop'
  | 'vehicle_expenses'
  | 'other_income';

export interface SafeImportIssue {
  code: string;
  severity: 'error' | 'warning';
  scope: 'workbook' | 'row';
  detail: string;
  field?: string;
  sheet_name?: string;
  source_row?: number;
}

export interface ImportSheetSelection {
  status: 'selected' | 'ambiguous' | 'missing';
  sheet: SafeWorkbookSheet | null;
  candidates: string[];
  issue?: SafeImportIssue;
}

export interface SafeParseResult<T> {
  sheet_name: string;
  rows: T[];
  issues: SafeImportIssue[];
}

export interface SafeSourceFields {
  source_row: number;
  sheet_name: string;
}

export interface VehicleMasterImportRow extends SafeSourceFields {
  vehicle_id: string | null;
  plate_key: string;
  display_plate: string;
  business_unit: string;
  ownership_type: string;
  status: string;
  model: string | null;
}

export interface InsuranceImportRow extends SafeSourceFields {
  id: string | null;
  plate_key: string;
  premium: number | null;
  responsibility: string;
  coverage_start: string | null;
  coverage_end: string | null;
  payment_date: string | null;
  supplier: string | null;
  reference: string | null;
  source: string | null;
}

export interface OtherIncomeImportRow extends SafeSourceFields {
  id: string | null;
  finance_month: string | null;
  income_type: string;
  amount: number | null;
  plate_key: string | null;
  business_unit: string | null;
  receipt_date: string | null;
  reference: string | null;
  notes: string | null;
}

export interface RecurringCostImportRow extends SafeSourceFields {
  id: string | null;
  obligation_id: string | null;
  plate_key: string | null;
  category: string;
  cost_type: string;
  monthly_amount: number | null;
  start_month: string | null;
  end_month: string | null;
  payee: string | null;
  notes: string | null;
}

export interface CompanyExpenseImportRow extends SafeSourceFields {
  id: string | null;
  frequency: string;
  start_month: string | null;
  end_month: string | null;
  expense_date: string | null;
  category: string;
  amount: number | null;
  payee: string | null;
  reference: string | null;
  notes: string | null;
}

export interface WorkshopImportRow extends SafeSourceFields {
  id: string | null;
  frequency: 'ONE_OFF' | 'MONTHLY_RECURRING' | 'MONTHLY_SUMMARY' | string;
  start_month: string | null;
  end_month: string | null;
  plate_key: string;
  expense_date: string | null;
  amount: number | null;
  category: string;
  supplier: string | null;
  reference: string | null;
  description: string | null;
}

const worksheetNames: Record<SafeImportDestination, string[]> = {
  vehicle_master: ['Vehicle Master'],
  vehicle_monthly_costs: ['Vehicle Monthly Costs', 'Monthly Costs'],
  insurance: ['Insurance', 'Vehicle Insurance', 'Vehicle Other Costs'],
  fixed_cost: ['Fixed Operating Costs', 'Shared Opex'],
  company_expenses: ['Company Expenses', 'Shared Opex'],
  workshop: ['Workshop', 'Workshop Billing', 'Other Vehicle Costs', 'Vehicle Other Costs'],
  vehicle_expenses: ['Other Vehicle Costs', 'Vehicle Expenses'],
  other_income: ['Other Income'],
};

const aliases: Record<string, string[]> = {
  amount: ['amount', 'amountrm', 'monthlyamount', 'monthlyamountrm', 'cashamount', 'cashamountrm'],
  business_unit: ['businessunit'],
  category: ['category', 'expensename', 'expensecategory'],
  cost_type: ['costtype', 'category'],
  date: ['date', 'billingdate', 'costdate', 'expensedate'],
  description: ['description', 'details'],
  end_month: ['endmonth', 'effectiveuntil'],
  expense_date: ['expensedate', 'date'],
  finance_month: ['financemonth', 'month'],
  frequency: ['frequency'],
  model: ['vehiclemodel', 'model'],
  income_type: ['incometype', 'category'],
  notes: ['notes', 'note'],
  ownership_type: ['ownershiptype'],
  payee: ['payee', 'lender', 'payeelender'],
  plate: ['carplate', 'plate', 'vehicleplate', 'registrationno'],
  premium: ['premium', 'premiumrm', 'amount', 'amountrm'],
  record_id: ['recordid', 'id'],
  obligation_id: ['obligationid'],
  receipt_date: ['receiptdate'],
  reference: ['reference', 'invoiceno', 'receiptno'],
  responsibility: ['responsibility'],
  start_month: ['startmonth', 'effectivefrom'],
  status: ['status'],
  supplier: ['supplier', 'vendor', 'workshop'],
  source: ['source'],
  vehicle_id: ['vehicleid'],
  coverage_start: ['coveragestart'],
  coverage_end: ['coverageend'],
  payment_date: ['paymentdate'],
};

const requiredFields: Record<SafeImportDestination, string[]> = {
  vehicle_master: ['plate', 'business_unit', 'ownership_type', 'status'],
  vehicle_monthly_costs: ['plate', 'cost_type', 'amount', 'start_month'],
  insurance: ['plate', 'premium', 'responsibility'],
  fixed_cost: ['category', 'amount'],
  company_expenses: ['frequency', 'category', 'amount'],
  workshop: ['plate', 'date', 'amount'],
  vehicle_expenses: ['plate', 'amount'],
  other_income: ['finance_month', 'income_type', 'amount'],
};

const fieldLabels: Record<string, string> = {
  amount: 'Amount',
  business_unit: 'Business Unit',
  category: 'Category',
  cost_type: 'Cost Type',
  date: 'Date',
  finance_month: 'Finance Month',
  frequency: 'Frequency',
  income_type: 'Income Type',
  ownership_type: 'Ownership Type',
  plate: 'Car Plate',
  premium: 'Premium',
  responsibility: 'Responsibility',
  start_month: 'Start Month',
  status: 'Status',
};

export const normalizeImportHeader = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizedSheetName = (value: string): string => value.trim().toLocaleLowerCase('en');

const workbookIssue = (code: string, detail: string, field?: string, sheet_name?: string): SafeImportIssue => ({
  code,
  severity: 'error',
  scope: 'workbook',
  detail,
  ...(field ? { field } : {}),
  ...(sheet_name ? { sheet_name } : {}),
});

const rowIssue = (code: string, detail: string, row: SafeWorkbookRow, field?: string): SafeImportIssue => ({
  code,
  severity: 'error',
  scope: 'row',
  detail,
  sheet_name: row.sheet_name,
  source_row: row.source_row,
  ...(field ? { field } : {}),
});

export function selectImportSheet(
  sheets: SafeWorkbookSheet[],
  destination: SafeImportDestination,
  explicitName?: string,
): ImportSheetSelection {
  if (explicitName?.trim()) {
    const wanted = normalizedSheetName(explicitName);
    const selected = sheets.find((sheet) => normalizedSheetName(sheet.name) === wanted) ?? null;
    if (selected) return { status: 'selected', sheet: selected, candidates: [selected.name] };
    return {
      status: 'missing',
      sheet: null,
      candidates: [],
      issue: workbookIssue('MISSING_WORKSHEET', `Workbook is missing selected worksheet: ${explicitName.trim()}`),
    };
  }

  const accepted = new Set(worksheetNames[destination].map(normalizedSheetName));
  const candidates = sheets.filter((sheet) => accepted.has(normalizedSheetName(sheet.name)));
  if (candidates.length === 1) return { status: 'selected', sheet: candidates[0], candidates: [candidates[0].name] };
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      sheet: null,
      candidates: candidates.map((sheet) => sheet.name),
      issue: workbookIssue(
        'AMBIGUOUS_WORKSHEET',
        `Workbook contains multiple accepted worksheets for ${destination}; select one explicitly`,
      ),
    };
  }
  return {
    status: 'missing',
    sheet: null,
    candidates: [],
    issue: workbookIssue(
      'MISSING_WORKSHEET',
      `Workbook has no accepted worksheet for ${destination}: ${worksheetNames[destination].join(' or ')}`,
    ),
  };
}

function headerFor(headers: string[], field: string): string | undefined {
  const accepted = new Set(aliases[field] ?? [normalizeImportHeader(field)]);
  return headers.find((header) => accepted.has(normalizeImportHeader(header)));
}

function hasHeader(headers: string[], field: string): boolean {
  return headerFor(headers, field) !== undefined;
}

export function requiredHeaderIssues(headers: string[], destination: SafeImportDestination): SafeImportIssue[] {
  const issues = requiredFields[destination]
    .filter((field) => !hasHeader(headers, field))
    .map((field) => workbookIssue(
      'MISSING_REQUIRED_HEADER',
      `Workbook is missing required ${fieldLabels[field] ?? field} column`,
      field,
    ));
  if (destination === 'other_income' && !hasHeader(headers, 'plate') && !hasHeader(headers, 'business_unit')) {
    issues.push(workbookIssue(
      'MISSING_REQUIRED_HEADER',
      'Workbook requires either Car Plate or Business Unit column',
      'income_target',
    ));
  }
  return issues;
}

export function unwrapFormulaValue(value: unknown): unknown {
  let current = value;
  const visited = new Set<object>();
  while (current !== null && typeof current === 'object' && !Array.isArray(current) && !(current instanceof Date)) {
    const object = current as Record<string, unknown>;
    if (visited.has(object)) return null;
    visited.add(object);
    if (Object.prototype.hasOwnProperty.call(object, 'result')) {
      current = object.result;
      continue;
    }
    if (typeof object.text === 'string') return object.text;
    if (Array.isArray(object.richText)) {
      return object.richText
        .map((part) => part && typeof part === 'object' ? String((part as Record<string, unknown>).text ?? '') : '')
        .join('');
    }
    return current;
  }
  return current;
}

export function parseImportMoney(value: unknown): number | null {
  const raw = unwrapFormulaValue(value);
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && Math.abs(raw * 100 - Math.round(raw * 100)) < 1e-7 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1).trim();
  text = text.replace(/^(?:RM|MYR)\s*/i, '').replace(/[\s,]/g, '');
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseImportDate(value: unknown): string | null {
  const raw = unwrapFormulaValue(value);
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return isoDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0 || raw >= 100000) return null;
    const serialDay = Math.floor(raw);
    const date = new Date(Date.UTC(1899, 11, 30) + serialDay * 86400000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

const monthNumbers: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function parseImportMonth(value: unknown): string | null {
  const raw = unwrapFormulaValue(value);
  if (raw instanceof Date || typeof raw === 'number') {
    const parsedDate = parseImportDate(raw);
    return parsedDate ? `${parsedDate.slice(0, 7)}-01` : null;
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), 1);
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const parsedDate = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return parsedDate ? `${parsedDate.slice(0, 7)}-01` : null;
  }
  match = /^(\d{1,2})[\/-](\d{4})$/.exec(text);
  if (match) return isoDate(Number(match[2]), Number(match[1]), 1);
  match = /^([a-z]+)[\s-]+(\d{4})$/i.exec(text);
  if (match) {
    const month = monthNumbers[match[1].toLowerCase()];
    return month ? isoDate(Number(match[2]), month, 1) : null;
  }
  const parsedDate = parseImportDate(text);
  return parsedDate ? `${parsedDate.slice(0, 7)}-01` : null;
}

const textValue = (value: unknown): string => {
  const unwrapped = unwrapFormulaValue(value);
  return typeof unwrapped === 'string' || typeof unwrapped === 'number' ? String(unwrapped).trim() : '';
};

export const normalizeImportPlate = (value: unknown): string => textValue(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

function cell(sheet: SafeWorkbookSheet, row: SafeWorkbookRow, field: string): unknown {
  const header = headerFor(sheet.headers, field);
  return header ? row.values[header] : null;
}

function isBlank(value: unknown): boolean {
  const raw = unwrapFormulaValue(value);
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

function sourceFields(row: SafeWorkbookRow): SafeSourceFields {
  return { source_row: row.source_row, sheet_name: row.sheet_name };
}

function selectedMonth(value: string | undefined): string | null {
  return value === undefined ? null : parseImportMonth(value);
}

const identityValue = (value: unknown): string | null => textValue(value) || null;

function normalizedFrequency(value: unknown): 'ONE_OFF' | 'MONTHLY_RECURRING' | 'MONTHLY_SUMMARY' | string {
  const raw = textValue(value);
  if (/^monthly[\s_-]*summary$/i.test(raw)) return 'MONTHLY_SUMMARY';
  if (/^monthly[\s_-]*recurring$/i.test(raw) || /^monthly$/i.test(raw) || /^recurr(?:ing)?$/i.test(raw)) return 'MONTHLY_RECURRING';
  if (/^one[\s_-]*off$/i.test(raw) || /^once$/i.test(raw)) return 'ONE_OFF';
  return raw;
}

export function parseVehicleRows(sheet: SafeWorkbookSheet): SafeParseResult<VehicleMasterImportRow> {
  const issues = requiredHeaderIssues(sheet.headers, 'vehicle_master');
  if (issues.length) return { sheet_name: sheet.name, rows: [], issues: issues.map((issue) => ({ ...issue, sheet_name: sheet.name })) };
  const rows = sheet.rows.map((row): VehicleMasterImportRow => {
    const displayPlate = textValue(cell(sheet, row, 'plate'));
    const plate = normalizeImportPlate(displayPlate);
    const businessUnit = textValue(cell(sheet, row, 'business_unit'));
    const ownershipType = textValue(cell(sheet, row, 'ownership_type'));
    const status = textValue(cell(sheet, row, 'status'));
    if (!plate) issues.push(rowIssue('MISSING_PLATE', `Row ${row.source_row} has no Car Plate`, row, 'plate'));
    if (!businessUnit) issues.push(rowIssue('MISSING_BUSINESS_UNIT', `Row ${row.source_row} has no Business Unit`, row, 'business_unit'));
    if (!ownershipType) issues.push(rowIssue('MISSING_OWNERSHIP_TYPE', `Row ${row.source_row} has no Ownership Type`, row, 'ownership_type'));
    if (!status) issues.push(rowIssue('MISSING_STATUS', `Row ${row.source_row} has no Status`, row, 'status'));
    return {
      ...sourceFields(row),
      vehicle_id: identityValue(cell(sheet, row, 'vehicle_id')) ?? identityValue(cell(sheet, row, 'record_id')),
      plate_key: plate,
      display_plate: displayPlate,
      business_unit: businessUnit,
      ownership_type: ownershipType,
      status,
      model: textValue(cell(sheet, row, 'model')) || null,
    };
  });
  return { sheet_name: sheet.name, rows, issues };
}

export function parseInsuranceRows(sheet: SafeWorkbookSheet): SafeParseResult<InsuranceImportRow> {
  const issues = requiredHeaderIssues(sheet.headers, 'insurance');
  if (issues.length) return { sheet_name: sheet.name, rows: [], issues: issues.map((issue) => ({ ...issue, sheet_name: sheet.name })) };
  const rows = sheet.rows.map((row): InsuranceImportRow => {
    const plate = normalizeImportPlate(cell(sheet, row, 'plate'));
    const premium = parseImportMoney(cell(sheet, row, 'premium'));
    const responsibility = textValue(cell(sheet, row, 'responsibility')).toUpperCase().replace(/[\s-]+/g, '_');
    const coverageStartRaw = cell(sheet, row, 'coverage_start');
    const coverageEndRaw = cell(sheet, row, 'coverage_end');
    const paymentDateRaw = cell(sheet, row, 'payment_date');
    const coverageStart = parseImportDate(coverageStartRaw);
    const coverageEnd = parseImportDate(coverageEndRaw);
    const paymentDate = parseImportDate(paymentDateRaw);
    if (!plate) issues.push(rowIssue('MISSING_PLATE', `Row ${row.source_row} has no Car Plate`, row, 'plate'));
    if (premium === null || premium < 0) issues.push(rowIssue('INVALID_PREMIUM', `Row ${row.source_row} has no valid non-negative Premium`, row, 'premium'));
    if (!responsibility) issues.push(rowIssue('INVALID_INSURANCE_RESPONSIBILITY', `Row ${row.source_row} has no Responsibility`, row, 'responsibility'));
    if (!isBlank(coverageStartRaw) && !coverageStart) issues.push(rowIssue('INVALID_COVERAGE_START', `Row ${row.source_row} has an invalid Coverage Start`, row, 'coverage_start'));
    if (!isBlank(coverageEndRaw) && !coverageEnd) issues.push(rowIssue('INVALID_COVERAGE_END', `Row ${row.source_row} has an invalid Coverage End`, row, 'coverage_end'));
    if (!isBlank(paymentDateRaw) && !paymentDate) issues.push(rowIssue('INVALID_PAYMENT_DATE', `Row ${row.source_row} has an invalid Payment Date`, row, 'payment_date'));
    if (coverageStart && coverageEnd && coverageEnd < coverageStart) issues.push(rowIssue('INVALID_COVERAGE_RANGE', `Row ${row.source_row} coverage ends before it starts`, row, 'coverage_end'));
    return {
      ...sourceFields(row),
      id: identityValue(cell(sheet, row, 'record_id')),
      plate_key: plate,
      premium,
      responsibility,
      coverage_start: coverageStart,
      coverage_end: coverageEnd,
      payment_date: paymentDate,
      supplier: textValue(cell(sheet, row, 'supplier')) || null,
      reference: textValue(cell(sheet, row, 'reference')) || null,
      source: textValue(cell(sheet, row, 'source')) || null,
    };
  });
  return { sheet_name: sheet.name, rows, issues };
}

export function parseOtherIncomeRows(
  sheet: SafeWorkbookSheet,
  options: { expectedMonth?: string } = {},
): SafeParseResult<OtherIncomeImportRow> {
  const issues = requiredHeaderIssues(sheet.headers, 'other_income');
  if (issues.length) return { sheet_name: sheet.name, rows: [], issues: issues.map((issue) => ({ ...issue, sheet_name: sheet.name })) };
  const expected = selectedMonth(options.expectedMonth);
  const rows = sheet.rows.map((row): OtherIncomeImportRow => {
    const month = parseImportMonth(cell(sheet, row, 'finance_month'));
    const incomeType = textValue(cell(sheet, row, 'income_type'));
    const amount = parseImportMoney(cell(sheet, row, 'amount'));
    const plate = normalizeImportPlate(cell(sheet, row, 'plate')) || null;
    const businessUnit = textValue(cell(sheet, row, 'business_unit')) || null;
    const receiptRaw = cell(sheet, row, 'receipt_date');
    const receiptDate = parseImportDate(receiptRaw);
    if (!month) issues.push(rowIssue('INVALID_FINANCE_MONTH', `Row ${row.source_row} has no valid Finance Month`, row, 'finance_month'));
    if (!incomeType) issues.push(rowIssue('MISSING_INCOME_TYPE', `Row ${row.source_row} has no Income Type`, row, 'income_type'));
    if (amount === null) issues.push(rowIssue('INVALID_AMOUNT', `Row ${row.source_row} has no valid Amount`, row, 'amount'));
    if (!plate && !businessUnit) issues.push(rowIssue('MISSING_INCOME_TARGET', `Row ${row.source_row} requires Car Plate or Business Unit`, row, 'income_target'));
    if (!isBlank(receiptRaw) && !receiptDate) issues.push(rowIssue('INVALID_RECEIPT_DATE', `Row ${row.source_row} has an invalid Receipt Date`, row, 'receipt_date'));
    if (expected && ((month && month !== expected) || (receiptDate && receiptDate.slice(0, 7) !== expected.slice(0, 7)))) {
      issues.push(rowIssue('MONTH_MISMATCH', `Row ${row.source_row} is outside selected month ${expected.slice(0, 7)}`, row, 'finance_month'));
    }
    return {
      ...sourceFields(row),
      id: identityValue(cell(sheet, row, 'record_id')),
      finance_month: month,
      income_type: incomeType,
      amount,
      plate_key: plate,
      business_unit: businessUnit,
      receipt_date: receiptDate,
      reference: textValue(cell(sheet, row, 'reference')) || null,
      notes: textValue(cell(sheet, row, 'notes')) || null,
    };
  });
  return { sheet_name: sheet.name, rows, issues };
}

export function parseRecurringCostRows(
  sheet: SafeWorkbookSheet,
  destination: 'vehicle_monthly_costs' | 'fixed_cost',
): SafeParseResult<RecurringCostImportRow> {
  const issues = requiredHeaderIssues(sheet.headers, destination);
  if (issues.length) return { sheet_name: sheet.name, rows: [], issues: issues.map((issue) => ({ ...issue, sheet_name: sheet.name })) };
  const rows = sheet.rows.map((row): RecurringCostImportRow => {
    const recordId = identityValue(cell(sheet, row, 'record_id'));
    const obligationId = identityValue(cell(sheet, row, 'obligation_id'));
    const plate = normalizeImportPlate(cell(sheet, row, 'plate')) || null;
    const category = textValue(cell(sheet, row, destination === 'vehicle_monthly_costs' ? 'cost_type' : 'category'));
    const amount = parseImportMoney(cell(sheet, row, 'amount'));
    const start = parseImportMonth(cell(sheet, row, 'start_month'));
    const endRaw = cell(sheet, row, 'end_month');
    const end = parseImportMonth(endRaw);
    if (destination === 'vehicle_monthly_costs' && !plate) issues.push(rowIssue('MISSING_PLATE', `Row ${row.source_row} has no Car Plate`, row, 'plate'));
    if (!category) issues.push(rowIssue('MISSING_CATEGORY', `Row ${row.source_row} has no cost category`, row, 'category'));
    if (amount === null || amount < 0) issues.push(rowIssue('INVALID_AMOUNT', `Row ${row.source_row} has no valid non-negative amount`, row, 'amount'));
    if (destination === 'vehicle_monthly_costs' && !start) issues.push(rowIssue('INVALID_START_MONTH', `Row ${row.source_row} has no valid Start Month`, row, 'start_month'));
    if (destination === 'vehicle_monthly_costs' && !isBlank(endRaw) && !end) issues.push(rowIssue('INVALID_END_MONTH', `Row ${row.source_row} has an invalid End Month`, row, 'end_month'));
    if (destination === 'vehicle_monthly_costs' && start && end && end < start) issues.push(rowIssue('INVALID_MONTH_RANGE', `Row ${row.source_row} ends before it starts`, row, 'end_month'));
    return {
      ...sourceFields(row),
      id: recordId,
      obligation_id: destination === 'vehicle_monthly_costs' ? obligationId ?? recordId : null,
      plate_key: plate,
      category,
      cost_type: category,
      monthly_amount: amount,
      start_month: start,
      end_month: end,
      payee: textValue(cell(sheet, row, 'payee')) || null,
      notes: textValue(cell(sheet, row, 'notes')) || null,
    };
  });
  return { sheet_name: sheet.name, rows, issues };
}

export function parseExpenseRows(
  sheet: SafeWorkbookSheet,
  options: { expectedMonth?: string } = {},
): SafeParseResult<CompanyExpenseImportRow> {
  const issues = requiredHeaderIssues(sheet.headers, 'company_expenses');
  if (issues.length) return { sheet_name: sheet.name, rows: [], issues: issues.map((issue) => ({ ...issue, sheet_name: sheet.name })) };
  const expected = selectedMonth(options.expectedMonth);
  const rows = sheet.rows.map((row): CompanyExpenseImportRow => {
    const frequencyValue = textValue(cell(sheet, row, 'frequency'));
    const frequency = normalizedFrequency(frequencyValue);
    const recurring = frequency === 'MONTHLY_RECURRING';
    const summary = frequency === 'MONTHLY_SUMMARY';
    const oneOff = frequency === 'ONE_OFF';
    const startRaw = cell(sheet, row, 'start_month');
    const endRaw = cell(sheet, row, 'end_month');
    const dateRaw = cell(sheet, row, 'expense_date');
    const start = parseImportMonth(startRaw);
    const end = parseImportMonth(endRaw);
    const expenseDate = parseImportDate(dateRaw);
    const category = textValue(cell(sheet, row, 'category'));
    const amount = parseImportMoney(cell(sheet, row, 'amount'));
    if (!frequencyValue) issues.push(rowIssue('MISSING_FREQUENCY', `Row ${row.source_row} has no Frequency`, row, 'frequency'));
    else if (!recurring && !summary && !oneOff) issues.push(rowIssue('INVALID_FREQUENCY', `Row ${row.source_row} requires ONE_OFF, MONTHLY_RECURRING, or MONTHLY_SUMMARY Frequency`, row, 'frequency'));
    if (!category) issues.push(rowIssue('MISSING_CATEGORY', `Row ${row.source_row} has no Category`, row, 'category'));
    if (amount === null || amount < 0) issues.push(rowIssue('INVALID_AMOUNT', `Row ${row.source_row} has no valid non-negative Amount`, row, 'amount'));
    if (recurring && !start) issues.push(rowIssue('INVALID_START_MONTH', `Row ${row.source_row} recurring expense requires a valid Start Month`, row, 'start_month'));
    if (summary && (!start || !end || start !== end)) issues.push(rowIssue('INVALID_SUMMARY_MONTH', `Row ${row.source_row} monthly summary requires matching Start Month and End Month`, row, 'start_month'));
    if (oneOff && !expenseDate) issues.push(rowIssue('MISSING_EXPENSE_DATE', `Row ${row.source_row} one-off expense requires a valid Expense Date`, row, 'expense_date'));
    if (!isBlank(endRaw) && !end) issues.push(rowIssue('INVALID_END_MONTH', `Row ${row.source_row} has an invalid End Month`, row, 'end_month'));
    if (start && end && end < start) issues.push(rowIssue('INVALID_MONTH_RANGE', `Row ${row.source_row} ends before it starts`, row, 'end_month'));
    if (expected && ((expenseDate && expenseDate.slice(0, 7) !== expected.slice(0, 7)) || (start && start > expected) || (end && end < expected) || (summary && start && start !== expected))) {
      issues.push(rowIssue('MONTH_MISMATCH', `Row ${row.source_row} does not apply to selected month ${expected.slice(0, 7)}`, row));
    }
    return {
      ...sourceFields(row),
      id: identityValue(cell(sheet, row, 'record_id')),
      frequency,
      start_month: start,
      end_month: end,
      expense_date: expenseDate,
      category,
      amount,
      payee: textValue(cell(sheet, row, 'payee')) || null,
      reference: textValue(cell(sheet, row, 'reference')) || null,
      notes: textValue(cell(sheet, row, 'notes')) || null,
    };
  });
  return { sheet_name: sheet.name, rows, issues };
}

export function parseWorkshopRows(
  sheet: SafeWorkbookSheet,
  options: { expectedMonth?: string; impliedCategory?: string } = {},
): SafeParseResult<WorkshopImportRow> {
  const issues = requiredHeaderIssues(sheet.headers, 'workshop');
  if (!options.impliedCategory?.trim() && !hasHeader(sheet.headers, 'category')) {
    issues.push(workbookIssue('MISSING_REQUIRED_HEADER', 'Workbook is missing required Category column', 'category', sheet.name));
  }
  if (issues.length) return { sheet_name: sheet.name, rows: [], issues: issues.map((issue) => ({ ...issue, sheet_name: sheet.name })) };
  const expected = selectedMonth(options.expectedMonth);
  const rows = sheet.rows.map((row): WorkshopImportRow => {
    const frequencyRaw = cell(sheet, row, 'frequency');
    const frequencyValue = normalizedFrequency(frequencyRaw);
    const frequency = frequencyValue || 'ONE_OFF';
    const recurring = frequency === 'MONTHLY_RECURRING';
    const summary = frequency === 'MONTHLY_SUMMARY';
    const oneOff = frequency === 'ONE_OFF';
    const startRaw = cell(sheet, row, 'start_month');
    const endRaw = cell(sheet, row, 'end_month');
    const start = parseImportMonth(startRaw);
    const end = parseImportMonth(endRaw);
    const plate = normalizeImportPlate(cell(sheet, row, 'plate'));
    const dateValue = parseImportDate(cell(sheet, row, 'date'));
    const amount = parseImportMoney(cell(sheet, row, 'amount'));
    const category = options.impliedCategory?.trim() || textValue(cell(sheet, row, 'category'));
    if (!oneOff && !recurring && !summary) issues.push(rowIssue('INVALID_FREQUENCY', `Row ${row.source_row} requires ONE_OFF, MONTHLY_RECURRING, or MONTHLY_SUMMARY Frequency`, row, 'frequency'));
    if (!plate) issues.push(rowIssue('MISSING_PLATE', `Row ${row.source_row} has no Car Plate`, row, 'plate'));
    if (oneOff && !dateValue) issues.push(rowIssue('INVALID_EXPENSE_DATE', `Row ${row.source_row} one-off expense requires a valid Date`, row, 'date'));
    if (recurring && !start) issues.push(rowIssue('INVALID_START_MONTH', `Row ${row.source_row} recurring expense requires a valid Start Month`, row, 'start_month'));
    if (summary && (!start || !end || start !== end)) issues.push(rowIssue('INVALID_SUMMARY_MONTH', `Row ${row.source_row} monthly summary requires matching Start Month and End Month`, row, 'start_month'));
    if (!isBlank(endRaw) && !end) issues.push(rowIssue('INVALID_END_MONTH', `Row ${row.source_row} has an invalid End Month`, row, 'end_month'));
    if (start && end && end < start) issues.push(rowIssue('INVALID_MONTH_RANGE', `Row ${row.source_row} ends before it starts`, row, 'end_month'));
    if (amount === null || amount < 0) issues.push(rowIssue('INVALID_AMOUNT', `Row ${row.source_row} has no valid non-negative Amount`, row, 'amount'));
    if (!category) issues.push(rowIssue('MISSING_CATEGORY', `Row ${row.source_row} has no Category`, row, 'category'));
    if (expected && ((dateValue && dateValue.slice(0, 7) !== expected.slice(0, 7)) || (summary && start && start !== expected))) {
      issues.push(rowIssue('MONTH_MISMATCH', `Row ${row.source_row} is outside selected month ${expected.slice(0, 7)}`, row, 'date'));
    }
    return {
      ...sourceFields(row),
      id: identityValue(cell(sheet, row, 'record_id')),
      frequency,
      start_month: start,
      end_month: end,
      plate_key: plate,
      expense_date: dateValue,
      amount,
      category,
      supplier: textValue(cell(sheet, row, 'supplier')) || null,
      reference: textValue(cell(sheet, row, 'reference')) || null,
      description: textValue(cell(sheet, row, 'description')) || null,
    };
  });
  return { sheet_name: sheet.name, rows, issues };
}
