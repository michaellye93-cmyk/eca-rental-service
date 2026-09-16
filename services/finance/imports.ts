import ExcelJS from 'exceljs';
import { normalizePlate } from './calculations.ts';
import { parseInsuranceSheet, insuranceAliases, type InsuranceSummary } from './insuranceImport.ts';
import { corporateAliases } from './corporateImport.ts';
import type { BootstrapData, FinanceExpense, FinanceVehicle, ImportPreview, QualityIssue, SmartDriveRow } from '../../types/finance.ts';

export interface WorkbookSheet { name: string; headers: string[]; rows: Array<{ source_row: number; sheet_name: string; values: Record<string, unknown> }> }
export interface WorkbookReadResult { sheets: WorkbookSheet[] }
export interface BootstrapPreview { data: BootstrapData; issues: QualityIssue[]; filename: string; insurance_summary?: InsuranceSummary }
export interface WorkshopPreview { rows: FinanceExpense[]; issues: QualityIssue[]; filename: string; report_month: string; total_rows: number; matched_vehicles: number; unmatched_vehicles: number; gross_revenue: number; commission: number }
export type FieldMapping = Record<string, string | undefined> & { sheet?: string };

const pii = /^(customer\s*name|customer|ic[_ /-]?passport|passport|phone([_ /-]?number)?|email|identity|nric)$/i;
const cleanHeader = (value: unknown) => String(value ?? '').trim();
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases: Record<string, string[]> = {
  responsibility: ['responsibility'],
  reference: ['reference', 'bookingreference', 'bookingid', 'bookingno', 'id'], plate: ['carplate', 'plate', 'vehicleplate', 'registrationno'],
  pickup: ['startdate', 'pickupdate', 'pickupdate', 'bookingstart'], return: ['enddate', 'returndate', 'dropoffdate', 'bookingend'],
  revenue: ['revenue', 'grossrevenue', 'rentalrevenue', 'amount'], commission: ['commissionpaid', 'commission', 'agentcommission'],
  status: ['transactionstatusdate', 'transactionstatus', 'status'], paymentStatus: ['paymentstatus'], billingDate: ['billingdate', 'date'],
  supplier: ['supplier', 'workshop', 'vendor'], amount: ['amount', 'cost', 'total'], costType: ['costtype', 'category'], startMonth: ['startmonth'], endMonth: ['endmonth'],
  businessUnit: ['businessunit'], ownershipType: ['ownershiptype'], coverageStart: ['coveragestart'], coverageEnd: ['coverageend'], premium: ['premium'], paymentDate: ['paymentdate'], payee: ['payee', 'lender', 'payeelender'], notes: ['notes'], description: ['description'], monthlyAmount: ['monthlyamount', 'monthlyamountrm'],
};

function value(cell: ExcelJS.Cell): unknown {
  const raw = cell.value as any;
  if (raw && typeof raw === 'object' && 'result' in raw) return raw.result;
  if (raw && typeof raw === 'object' && 'text' in raw) return raw.text;
  return raw;
}
function date(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 1 && value < 100000) return new Date(Date.UTC(1899, 11, 30 + value)).toISOString().slice(0, 10);
  const text = String(value ?? '').trim(); if (!text) return null;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = slash ? `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}` : text.slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}
function numeric(value: unknown): number | null { if (typeof value === 'number' && Number.isFinite(value)) return value; const parsed = Number(String(value ?? '').replace(/[RM,\s]/g, '')); return String(value ?? '').trim() && Number.isFinite(parsed) ? parsed : null; }
function monthFromDate(value: string | null): string | null { return value?.slice(0, 7) ?? null; }
const canonicalMonth = (value: string) => /^\d{4}-\d{2}/.test(value) ? `${value.slice(0, 7)}-01` : '';
const canonicalMonthValue = (value: unknown) => canonicalMonth(date(value) ?? String(value ?? ''));
function issue(code: string, detail: string, severity: 'error' | 'warning' = 'error', plate_key: string | null = null, source_id: string | null = null): QualityIssue { return { code, severity, detail, plate_key, source_id }; }

async function load(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); return workbook; }
function sheetRows(sheet: ExcelJS.Worksheet): WorkbookSheet {
  let headerRow = 1; let bestScore = -1;
  for (let candidate = 1; candidate <= Math.min(sheet.rowCount, 20); candidate++) {
    const values = sheet.getRow(candidate).values; const cells = Array.isArray(values) ? values.slice(1).map(cleanHeader) : [];
    const score = cells.reduce((total, header) => total + (Object.values(aliases).concat(Object.values(insuranceAliases), Object.values(corporateAliases)).some((options) => options.includes(key(header))) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; headerRow = candidate; }
  }
  const headerValues = sheet.getRow(headerRow).values;
  const headers = (Array.isArray(headerValues) ? headerValues : []).slice(1).map(cleanHeader);
  const rows: WorkbookSheet['rows'] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber); const values: Record<string, unknown> = {};
    headers.forEach((header, index) => { const cellValue = value(row.getCell(index + 1)); if (header && !pii.test(header) && cellValue !== null && cellValue !== undefined && cellValue !== '') values[header] = cellValue; });
    if (Object.keys(values).length) rows.push({ source_row: rowNumber, sheet_name: sheet.name, values });
  }
  return { name: sheet.name, headers: headers.filter((header) => header && !pii.test(header)), rows };
}

export async function readFinanceWorkbook(buffer: ArrayBuffer): Promise<WorkbookReadResult> { return { sheets: (await load(buffer)).worksheets.map(sheetRows) }; }
function selectSheet(workbook: ExcelJS.Workbook, name?: string, aliases: string[] = [], required = false): ExcelJS.Worksheet { const sheet = name ? workbook.getWorksheet(name) : workbook.worksheets.find((candidate) => aliases.includes(candidate.name)) ?? (required ? undefined : workbook.worksheets[0]); if (!sheet) throw new Error(name ? `Workbook is missing required sheet: ${name}` : `Workbook is missing required sheet: ${aliases.join(' or ')}`); return sheet; }
function field(row: Record<string, unknown>, headers: string[], name: string, mapping?: FieldMapping): unknown {
  const requested = mapping?.[name]; const header = requested ? headers.find((value) => value === requested) : headers.find((value) => aliases[name]?.includes(key(value)));
  return header ? row[header] : null;
}
function rawRows(sheet: ExcelJS.Worksheet) { return sheetRows(sheet); }
function vehicleSet(vehicles: FinanceVehicle[]) { return new Set(vehicles.map((vehicle) => normalizePlate(vehicle.plate_key))); }
function hasField(headers: string[], name: string, mapping?: FieldMapping) { return mapping?.[name] ? headers.includes(mapping[name]!) : headers.some((header) => aliases[name]?.includes(key(header))); }
function requiredHeaderIssues(headers: string[], fields: string[], mapping?: FieldMapping): QualityIssue[] { return fields.filter((name) => !hasField(headers, name, mapping)).map((name) => issue('MISSING_REQUIRED_HEADER', `Workbook is missing required ${name} column`)); }

export async function previewSmartDrive(buffer: ArrayBuffer, filename: string, month: string, vehicles: FinanceVehicle[], mapping?: FieldMapping): Promise<ImportPreview<SmartDriveRow>> {
  const workbook = await load(buffer); const source = rawRows(selectSheet(workbook, mapping?.sheet)); const known = vehicleSet(vehicles); const issues: QualityIssue[] = requiredHeaderIssues(source.headers, ['plate', 'pickup', 'return', 'revenue', 'commission', 'status'], mapping); let matched = 0; let unmatched = 0; let gross = 0; let commission = 0;
  if (!source.rows.length) issues.push(issue('EMPTY_REPORT', 'Workbook contains no Finance rows'));
  const references = new Set<string>();
  const rows = source.rows.map((sourceRow) => {
    const plate = normalizePlate(String(field(sourceRow.values, source.headers, 'plate', mapping) ?? ''));
    const pickup = date(field(sourceRow.values, source.headers, 'pickup', mapping)); const returned = date(field(sourceRow.values, source.headers, 'return', mapping));
    const revenue = numeric(field(sourceRow.values, source.headers, 'revenue', mapping)); const fee = numeric(field(sourceRow.values, source.headers, 'commission', mapping));
    const referenceValue = field(sourceRow.values, source.headers, 'reference', mapping); const sourceId = referenceValue ? String(referenceValue) : null;
    if (!plate) issues.push(issue('MISSING_PLATE', `Row ${sourceRow.source_row} has no car plate`, 'error', null, sourceId)); else if (known.has(plate)) matched++; else { unmatched++; issues.push(issue('UNMATCHED_PLATE', `Row ${sourceRow.source_row} plate is not in Finance vehicle master`, 'error', plate, sourceId)); }
    if (!pickup) issues.push(issue('MISSING_PICKUP_DATE', `Row ${sourceRow.source_row} has no valid pickup date`, 'error', plate, sourceId));
    if (!returned) issues.push(issue('MISSING_RETURN_DATE', `Row ${sourceRow.source_row} has no valid return date`, 'error', plate, sourceId));
    if (revenue === null) issues.push(issue('MISSING_GROSS_REVENUE', `Row ${sourceRow.source_row} has no valid gross revenue`, 'error', plate, sourceId));
    if (fee === null) issues.push(issue('MISSING_COMMISSION', `Row ${sourceRow.source_row} has no valid commission`, 'error', plate, sourceId));
    if (revenue !== null && revenue < 0) issues.push(issue('NEGATIVE_GROSS_REVENUE', `Row ${sourceRow.source_row} has negative gross revenue`, 'error', plate, sourceId));
    if (fee !== null && fee < 0) issues.push(issue('NEGATIVE_COMMISSION', `Row ${sourceRow.source_row} has negative commission`, 'error', plate, sourceId));
    if (revenue !== null && fee !== null && fee > revenue) issues.push(issue('COMMISSION_EXCEEDS_GROSS', `Row ${sourceRow.source_row} commission exceeds gross revenue`, 'error', plate, sourceId));
    if (pickup && returned && pickup > returned) issues.push(issue('REVERSED_BOOKING_DATES', `Row ${sourceRow.source_row} return date is before pickup date`, 'error', plate, sourceId));
    if (!String(field(sourceRow.values, source.headers, 'status', mapping) ?? '').trim()) issues.push(issue('MISSING_STATUS', `Row ${sourceRow.source_row} has no booking or transaction status`, 'error', plate, sourceId));
    if (sourceId && references.has(sourceId)) issues.push(issue('DUPLICATE_SOURCE_REFERENCE', `Duplicate booking reference on row ${sourceRow.source_row}`, 'error', plate, sourceId));
    if (sourceId) references.add(sourceId);
    gross += revenue ?? 0; commission += fee ?? 0;
    return { source_row: sourceRow.source_row, sheet_name: sourceRow.sheet_name, reference: sourceId, plate_key: plate, display_plate: String(field(sourceRow.values, source.headers, 'plate', mapping) ?? ''), pickup_date: pickup ?? '', return_date: returned ?? '', gross_revenue: revenue ?? 0, commission: fee ?? 0, status: String(field(sourceRow.values, source.headers, 'status', mapping) ?? ''), payment_status: field(sourceRow.values, source.headers, 'paymentStatus', mapping) as string | null };
  });
  const matchedPlates = new Set(rows.filter(row => row.plate_key && known.has(row.plate_key)).map(row => row.plate_key));
  const unmatchedPlates = new Set(rows.filter(row => row.plate_key && !known.has(row.plate_key)).map(row => row.plate_key));
  return { rows, issues, filename, report_month: month, total_rows: rows.length, matched_rows: matched, unmatched_rows: rows.length - matched, matched_vehicles: matchedPlates.size, unmatched_vehicles: unmatchedPlates.size, gross_revenue: gross, commission };
}

export async function previewBootstrap(buffer: ArrayBuffer, filename: string, _month: string): Promise<BootstrapPreview> {
  const workbook = await load(buffer); const issues: QualityIssue[] = []; const data: BootstrapData = { vehicles: [], recurring_costs: [], insurance: [] };
  const masters = rawRows(selectSheet(workbook, 'Vehicle Master', [], true));
  const masterPlates = new Set<string>();
  for (const source of masters.rows) { const rawPlate = String(field(source.values, masters.headers, 'plate') ?? ''); const plate = normalizePlate(rawPlate); const unit = String(field(source.values, masters.headers, 'businessUnit') ?? ''); const ownership = String(field(source.values, masters.headers, 'ownershipType') ?? '').trim(); const status = String(field(source.values, masters.headers, 'status') ?? '').trim(); if (!plate || !['E-HAILING', 'DAILY RENTAL', 'SMART DRIVE', 'SAMBUNG BAYAR'].includes(unit) || !ownership || !status) { issues.push(issue('INVALID_VEHICLE_MASTER', `Vehicle Master row ${source.source_row} requires plate, business unit, ownership type, and status`)); continue; } if (masterPlates.has(plate)) { issues.push(issue('DUPLICATE_VEHICLE_MASTER', `Vehicle Master row ${source.source_row} repeats plate ${plate}`, 'error', plate)); continue; } masterPlates.add(plate); data.vehicles.push({ plate_key: plate, display_plate: rawPlate, business_unit: unit as FinanceVehicle['business_unit'], ownership_type: ownership, status, source_row: source.source_row, sheet_name: source.sheet_name } as FinanceVehicle); }
  const costs = rawRows(selectSheet(workbook, undefined, ['Vehicle Monthly Costs', 'Monthly Costs'], true));
  for (const source of costs.rows) { const amount = numeric(field(source.values, costs.headers, 'monthlyAmount')); const plate = normalizePlate(String(field(source.values, costs.headers, 'plate') ?? '')); const start = canonicalMonthValue(field(source.values, costs.headers, 'startMonth')); const endValue = field(source.values, costs.headers, 'endMonth'); const end = endValue ? canonicalMonthValue(endValue) : null; const costType = String(field(source.values, costs.headers, 'costType') ?? '').trim(); if (!plate || !start || (endValue && !end) || (end && end < start) || !costType || amount === null || amount < 0) { issues.push(issue('INVALID_MONTHLY_COST', `Monthly Costs row ${source.source_row} requires valid plate, months, cost type, and non-negative amount`)); continue; } if (/to\s*classify|unclassified/i.test(costType)) issues.push(issue('UNCLASSIFIED_RECURRING_COST', `Monthly Costs row ${source.source_row} retains an unclassified source label for Admin review`, 'warning', plate)); data.recurring_costs.push({ plate_key: plate, start_month: start, end_month: end, cost_type: costType, monthly_amount: amount, payee: String(field(source.values, costs.headers, 'payee') ?? '') || null, notes: String(field(source.values, costs.headers, 'notes') ?? '') || null, source_row: source.source_row, sheet_name: source.sheet_name } as any); }
  const insuranceSheet = workbook.worksheets.find((sheet) => ['Vehicle Insurance', 'Insurance'].includes(sheet.name));
  let insurance_summary: InsuranceSummary | undefined;
  if (!insuranceSheet) issues.push(issue('MISSING_INSURANCE_SHEET', 'Bootstrap workbook has no Vehicle Insurance or Insurance sheet', 'warning'));
  else {
    const parsed = parseInsuranceSheet(rawRows(insuranceSheet), masterPlates);
    data.insurance = parsed.rows;
    issues.push(...parsed.issues);
    insurance_summary = parsed.summary;
  }
  return { data, issues, filename, insurance_summary };
}

export async function previewWorkshop(buffer: ArrayBuffer, filename: string, month: string, vehicles: FinanceVehicle[], mapping?: FieldMapping): Promise<WorkshopPreview> {
  const workbook = await load(buffer); const source = rawRows(selectSheet(workbook, mapping?.sheet)); const known = vehicleSet(vehicles); const issues: QualityIssue[] = requiredHeaderIssues(source.headers, ['billingDate', 'plate', 'amount'], mapping); let matched = 0; let unmatched = 0;
  if (!source.rows.length) issues.push(issue('EMPTY_REPORT', 'Workbook contains no workshop rows'));
  const references = new Set<string>();
  const rows = source.rows.map((sourceRow) => { const plate = normalizePlate(String(field(sourceRow.values, source.headers, 'plate', mapping) ?? '')); const billing = date(field(sourceRow.values, source.headers, 'billingDate', mapping)); const amount = numeric(field(sourceRow.values, source.headers, 'amount', mapping)); const referenceValue = field(sourceRow.values, source.headers, 'reference', mapping); const reference = referenceValue ? String(referenceValue) : null;
    if (!plate) issues.push(issue('MISSING_PLATE', `Row ${sourceRow.source_row} has no car plate`, 'error', null, reference)); else if (known.has(plate)) matched++; else { unmatched++; issues.push(issue('UNMATCHED_PLATE', `Row ${sourceRow.source_row} plate is not in Finance vehicle master`, 'error', plate, reference)); }
    if (!billing) issues.push(issue('MISSING_BILLING_DATE', `Row ${sourceRow.source_row} has no valid billing date`, 'error', plate, reference)); else if (monthFromDate(billing) !== month) issues.push(issue('REPORT_MONTH_MISMATCH', `Row ${sourceRow.source_row} billing date is outside ${month}`, 'error', plate, reference));
    if (amount === null) issues.push(issue('MISSING_AMOUNT', `Row ${sourceRow.source_row} has no valid amount`, 'error', plate, reference));
    if (reference && references.has(reference)) issues.push(issue('DUPLICATE_SOURCE_REFERENCE', `Duplicate workshop reference on row ${sourceRow.source_row}`, 'error', plate, reference));
    if (reference) references.add(reference);
    return { finance_month: canonicalMonth(month), billing_date: billing ?? '', plate_key: plate || null, category: 'Service & Maintenance', payment_source: 'Workshop Billing' as const, supplier: String(field(sourceRow.values, source.headers, 'supplier', mapping) ?? '') || null, amount: amount ?? 0, reference, description: String(field(sourceRow.values, source.headers, 'description', mapping) ?? '') || null, source_row: sourceRow.source_row, sheet_name: sourceRow.sheet_name } as FinanceExpense;
  });
  return { rows, issues, filename, report_month: month, total_rows: rows.length, matched_vehicles: matched, unmatched_vehicles: unmatched, gross_revenue: 0, commission: 0 };
}
