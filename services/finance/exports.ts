import ExcelJS from 'exceljs';

export type FinanceEditableExportKind =
  | 'vehicle_master'
  | 'vehicle_monthly_costs'
  | 'insurance'
  | 'fixed_cost'
  | 'company_expenses'
  | 'workshop'
  | 'vehicle_expenses'
  | 'other_income';

type ExportRow = Record<string, unknown>;
type ColumnKind = 'text' | 'money' | 'date' | 'month';

interface ExportColumn {
  header: string;
  key: string;
  width: number;
  kind?: ColumnKind;
  identity?: boolean;
}

interface ExportDefinition {
  sheetName: string;
  columns: ExportColumn[];
  map: (row: ExportRow) => ExportRow;
}

const first = (row: ExportRow, keys: string[]): unknown => {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return null;
};

const text = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const isoDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
};

const money = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/^(?:RM|MYR)\s*/i, '').replace(/[\s,]/g, ''));
  return String(value ?? '').trim() && Number.isFinite(parsed) ? parsed : null;
};

const frequency = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (/^monthly[\s_-]*summary$/i.test(raw)) return 'MONTHLY_SUMMARY';
  if (/^monthly[\s_-]*recurring$/i.test(raw) || /^monthly$/i.test(raw) || /^recurr(?:ing)?$/i.test(raw)) return 'MONTHLY_RECURRING';
  if (/^one[\s_-]*off$/i.test(raw) || /^once$/i.test(raw)) return 'ONE_OFF';
  return raw || null;
};

function expenseValues(row: ExportRow, kind: 'company_expenses' | 'workshop' | 'vehicle_expenses'): ExportRow {
  const billingDate = first(row, ['billing_date', 'expense_date']);
  const explicitFrequency = frequency(row.frequency);
  let normalizedFrequency = explicitFrequency;
  if (!normalizedFrequency) {
    if ((kind === 'workshop' || kind === 'vehicle_expenses') && !billingDate) normalizedFrequency = 'MONTHLY_SUMMARY';
    else normalizedFrequency = billingDate ? 'ONE_OFF' : 'MONTHLY_RECURRING';
  }
  const financeMonth = first(row, ['finance_month']);
  const startMonth = normalizedFrequency === 'MONTHLY_SUMMARY'
    ? first(row, ['start_month', 'finance_month'])
    : first(row, ['start_month']);
  const endMonth = normalizedFrequency === 'MONTHLY_SUMMARY'
    ? first(row, ['end_month', 'start_month', 'finance_month'])
    : first(row, ['end_month']);
  return {
    id: text(first(row, ['id', 'record_id'])),
    frequency: normalizedFrequency,
    start_month: isoDate(startMonth ?? financeMonth),
    end_month: isoDate(endMonth),
    expense_date: normalizedFrequency === 'ONE_OFF' ? isoDate(billingDate) : null,
    plate: text(first(row, ['display_plate', 'plate_key'])),
    category: text(row.category),
    amount: money(row.amount),
    supplier: text(first(row, ['supplier', 'payee'])),
    reference: text(row.reference),
    description: text(first(row, ['description', 'notes', 'note'])),
  };
}

const identity = (header: string, key: string): ExportColumn => ({ header, key, width: 38, kind: 'text', identity: true });

const definitions: Record<FinanceEditableExportKind, ExportDefinition> = {
  vehicle_master: {
    sheetName: 'Vehicle Master',
    columns: [
      identity('Vehicle ID', 'vehicle_id'),
      { header: 'Car Plate', key: 'plate', width: 16 },
      { header: 'Business Unit', key: 'business_unit', width: 20 },
      { header: 'Ownership Type', key: 'ownership_type', width: 18 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Vehicle Model', key: 'model', width: 24 },
    ],
    map: (row) => ({
      vehicle_id: text(first(row, ['vehicle_id', 'id'])),
      plate: text(first(row, ['display_plate', 'plate_key'])),
      business_unit: text(row.business_unit),
      ownership_type: text(row.ownership_type),
      status: text(row.status),
      model: text(row.model),
    }),
  },
  vehicle_monthly_costs: {
    sheetName: 'Vehicle Monthly Costs',
    columns: [
      identity('Obligation ID', 'obligation_id'),
      { header: 'Car Plate', key: 'plate', width: 16 },
      { header: 'Cost Type', key: 'cost_type', width: 26 },
      { header: 'Monthly Amount (RM)', key: 'amount', width: 21, kind: 'money' },
      { header: 'Start Month', key: 'start_month', width: 16, kind: 'month' },
      { header: 'End Month', key: 'end_month', width: 16, kind: 'month' },
      { header: 'Payee / Lender', key: 'payee', width: 24 },
      { header: 'Notes', key: 'notes', width: 34 },
    ],
    map: (row) => ({
      obligation_id: text(first(row, ['obligation_id', 'id'])),
      plate: text(first(row, ['display_plate', 'plate_key'])),
      cost_type: text(first(row, ['cost_type', 'category'])),
      amount: money(first(row, ['monthly_amount', 'amount'])),
      start_month: isoDate(first(row, ['start_month', 'effective_from'])),
      end_month: isoDate(first(row, ['end_month', 'effective_until'])),
      payee: text(row.payee),
      notes: text(first(row, ['notes', 'note'])),
    }),
  },
  insurance: {
    sheetName: 'Insurance',
    columns: [
      identity('Record ID', 'id'),
      { header: 'Car Plate', key: 'plate', width: 16 },
      { header: 'Premium (RM)', key: 'premium', width: 18, kind: 'money' },
      { header: 'RESPONSIBILITY', key: 'responsibility', width: 20 },
      { header: 'Coverage Start', key: 'coverage_start', width: 17, kind: 'date' },
      { header: 'Coverage End', key: 'coverage_end', width: 17, kind: 'date' },
      { header: 'Payment Date', key: 'payment_date', width: 17, kind: 'date' },
      { header: 'Supplier / Payee', key: 'supplier', width: 24 },
      { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Source', key: 'source', width: 22 },
    ],
    map: (row) => ({
      id: text(first(row, ['id', 'record_id'])),
      plate: text(first(row, ['display_plate', 'plate_key'])),
      premium: money(row.premium),
      responsibility: text(row.responsibility),
      coverage_start: isoDate(row.coverage_start),
      coverage_end: isoDate(row.coverage_end),
      payment_date: isoDate(row.payment_date),
      supplier: text(row.supplier),
      reference: text(row.reference),
      source: text(row.source),
    }),
  },
  fixed_cost: {
    sheetName: 'Fixed Operating Costs',
    columns: [
      identity('Record ID', 'id'),
      { header: 'Expense Name', key: 'category', width: 28 },
      { header: 'Amount (RM)', key: 'amount', width: 18, kind: 'money' },
      { header: 'Payee', key: 'payee', width: 24 },
      { header: 'Note', key: 'notes', width: 34 },
    ],
    map: (row) => ({
      id: text(first(row, ['id', 'record_id'])),
      category: text(first(row, ['category', 'expense_name'])),
      amount: money(first(row, ['monthly_amount', 'amount'])),
      payee: text(row.payee),
      notes: text(first(row, ['note', 'notes'])),
    }),
  },
  company_expenses: {
    sheetName: 'Company Expenses',
    columns: [
      identity('Record ID', 'id'),
      { header: 'Frequency', key: 'frequency', width: 22 },
      { header: 'Start Month', key: 'start_month', width: 16, kind: 'month' },
      { header: 'End Month', key: 'end_month', width: 16, kind: 'month' },
      { header: 'Expense Date', key: 'expense_date', width: 17, kind: 'date' },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Amount (RM)', key: 'amount', width: 18, kind: 'money' },
      { header: 'Payee', key: 'supplier', width: 24 },
      { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Notes', key: 'description', width: 34 },
    ],
    map: (row) => expenseValues(row, 'company_expenses'),
  },
  workshop: {
    sheetName: 'Workshop',
    columns: [
      identity('Record ID', 'id'),
      { header: 'Frequency', key: 'frequency', width: 22 },
      { header: 'Start Month', key: 'start_month', width: 16, kind: 'month' },
      { header: 'End Month', key: 'end_month', width: 16, kind: 'month' },
      { header: 'Car Plate', key: 'plate', width: 16 },
      { header: 'Expense Date', key: 'expense_date', width: 17, kind: 'date' },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Amount (RM)', key: 'amount', width: 18, kind: 'money' },
      { header: 'Workshop', key: 'supplier', width: 24 },
      { header: 'Invoice No', key: 'reference', width: 20 },
      { header: 'Description', key: 'description', width: 34 },
    ],
    map: (row) => expenseValues(row, 'workshop'),
  },
  vehicle_expenses: {
    sheetName: 'Other Vehicle Costs',
    columns: [
      identity('Record ID', 'id'),
      { header: 'Frequency', key: 'frequency', width: 22 },
      { header: 'Start Month', key: 'start_month', width: 16, kind: 'month' },
      { header: 'End Month', key: 'end_month', width: 16, kind: 'month' },
      { header: 'Car Plate', key: 'plate', width: 16 },
      { header: 'Expense Date', key: 'expense_date', width: 17, kind: 'date' },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Amount (RM)', key: 'amount', width: 18, kind: 'money' },
      { header: 'Supplier', key: 'supplier', width: 24 },
      { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Description', key: 'description', width: 34 },
    ],
    map: (row) => expenseValues(row, 'vehicle_expenses'),
  },
  other_income: {
    sheetName: 'Other Income',
    columns: [
      identity('Record ID', 'id'),
      { header: 'Finance Month', key: 'finance_month', width: 17, kind: 'month' },
      { header: 'Income Type', key: 'income_type', width: 24 },
      { header: 'Amount (RM)', key: 'amount', width: 18, kind: 'money' },
      { header: 'Car Plate', key: 'plate', width: 16 },
      { header: 'Business Unit', key: 'business_unit', width: 20 },
      { header: 'Receipt Date', key: 'receipt_date', width: 17, kind: 'date' },
      { header: 'Reference', key: 'reference', width: 20 },
      { header: 'Notes', key: 'notes', width: 34 },
    ],
    map: (row) => ({
      id: text(first(row, ['id', 'record_id'])),
      finance_month: isoDate(row.finance_month),
      income_type: text(row.income_type),
      amount: money(row.amount),
      plate: text(first(row, ['display_plate', 'plate_key'])),
      business_unit: text(row.business_unit),
      receipt_date: isoDate(row.receipt_date),
      reference: text(row.reference),
      notes: text(row.notes),
    }),
  },
};

function styleWorksheet(worksheet: ExcelJS.Worksheet, columns: ExportColumn[]): void {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: columns.length } };
  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183449' } };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.eachCell((cell) => { cell.protection = { locked: true }; });

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    row.height = 20;
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.protection = { locked: Boolean(column.identity) };
      cell.alignment = { vertical: 'middle', horizontal: column.kind === 'money' ? 'right' : 'left' };
      if (column.identity) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EDF1' } };
      if (column.kind === 'money') cell.numFmt = '#,##0.00';
      if (column.kind === 'date') cell.numFmt = 'yyyy-mm-dd';
      if (column.kind === 'month') cell.numFmt = 'mmm-yyyy';
    });
  }
}

export async function exportFinanceEditableWorkbook(
  kind: FinanceEditableExportKind,
  rows: readonly Record<string, unknown>[],
): Promise<ArrayBuffer> {
  const definition = definitions[kind];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ECA Finance';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(definition.sheetName);
  worksheet.columns = definition.columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
  rows.forEach((row) => worksheet.addRow(definition.map(row)));
  styleWorksheet(worksheet, definition.columns);
  await worksheet.protect('', {
    spinCount: 1,
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertRows: true,
    deleteRows: true,
    autoFilter: true,
    sort: true,
  });
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
