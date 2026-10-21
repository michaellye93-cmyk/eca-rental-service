import { newWorkbook } from './excel.ts';
import { hpSchedule, VARIABLE_NOTE, type VehicleLoan } from './loans.ts';

/**
 * Finance → Vehicle loans → Schedule → Download Excel: one loan's HP schedule as the owner's sheet lays it out, a
 * header block (the loan's figures, in the bank letter's order) then the instalment table with its 31 March year-end
 * rows. The rules are hpSchedule in loans.ts; this file only writes them out. A variable-rate loan shows "—" where the
 * bank's statement gives the figure (interest, total, final instalment and the interest / principal split).
 */

export const HP_SCHEDULE_HEADERS = ['Year', 'Ins. No', 'Sum of Digit', 'Instalment', 'Interest', 'Principal', 'Total Instalment', 'Total Interest', 'Total Principal', 'Bal Due'] as const;

const MONEY = '#,##0.00';

/** "HP schedule XAA 1001.xlsx" */
export const hpScheduleFileName = (plate: string) => `HP schedule ${plate}.xlsx`;

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ] */
const sheetName = (plate: string) => (plate.replace(/[:\/?*[\]]/g, ' ').trim() || 'HP schedule').slice(0, 31);

/** 15.01.2024 from 2024-01-15. */
const dotted = (date: string) => (date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');

const round2 = (value: number) => Math.round(value * 100) / 100;
const NONE = '—';

export async function exportHpScheduleWorkbook(loan: VehicleLoan, model?: string | null): Promise<ArrayBuffer> {
  const schedule = hpSchedule(loan);
  const n = schedule.rows.length;
  const finance = Number(loan.finance_amount || 0);
  const downpayment = Number(loan.downpayment || 0);
  const monthly = Number(loan.monthly_instalment || 0);
  const variable = loan.rate_type === 'VARIABLE';
  const final = variable ? NONE : schedule.rows[n - 1]?.amount ?? 0;
  const cost = loan.cash_price === null || loan.cash_price === undefined ? round2(finance + downpayment) : Number(loan.cash_price);
  const hirer = loan.hirer?.trim();
  const workbook = await newWorkbook();
  const sheet = workbook.addWorksheet(sheetName(loan.display_plate));
  sheet.columns = [16, 32, 14, 14, 14, 14, 18, 16, 16, 14].map((width) => ({ width }));

  const header: Array<[string, string | number, (string | number)?]> = [
    ['Plate', loan.display_plate],
    ...(model?.trim() ? [['Model', model.trim()] as [string, string]] : []),
    ...(hirer ? [['Ownership', hirer] as [string, string]] : []),
    ['Loan provider', loan.bank],
    ['Cost', cost],
    ['Less downpayment', downpayment],
    ['HP financing', finance],
    [`Interest @ ${Number(loan.flat_rate_percent || 0).toFixed(2)}% ${variable ? 'variable' : 'flat'}`, schedule.totalInterest ?? NONE],
    ['Total', schedule.totalPayable ?? NONE],
    ...(loan.commencement_date ? [['Commencement Date', dotted(loan.commencement_date)] as [string, string]] : []),
    ['First payment date', dotted(schedule.rows[0]?.date ?? '')],
    ['Number of instalments', n],
    [`Monthly instalment × ${Math.max(0, n - 1)} months`, monthly, round2(monthly * Math.max(0, n - 1))],
    ['Final instalment × 1 month', final, final],
  ];
  for (const [label, value, total] of header) {
    const row = sheet.addRow(total === undefined ? [label, value] : [label, value, total]);
    row.getCell(1).font = { bold: true };
    if (typeof value === 'number' && !label.startsWith('Number')) row.getCell(2).numFmt = MONEY;
    if (typeof total === 'number') row.getCell(3).numFmt = MONEY;
    row.getCell(2).alignment = { horizontal: typeof value === 'number' || value === NONE ? 'right' : 'left' };
  }
  if (variable) sheet.addRow([VARIABLE_NOTE]).getCell(1).font = { italic: true };
  sheet.addRow([]);

  const head = sheet.addRow([...HP_SCHEDULE_HEADERS]);
  head.font = { bold: true };
  head.eachCell((cell) => { cell.border = { bottom: { style: 'thin' } }; });
  for (const item of schedule.rows) {
    const year = item.yearEnd;
    const row = sheet.addRow([
      year?.label ?? null, item.number, item.digit, item.amount, item.interest ?? NONE, item.principal ?? NONE,
      year?.instalments ?? null, year ? year.interest ?? NONE : null, year ? year.principal ?? NONE : null, year?.balance ?? null,
    ]);
    for (let col = 4; col <= 10; col++) row.getCell(col).numFmt = MONEY;
    if (year) {
      row.font = { bold: true };
      for (let col = 1; col <= 10; col++) row.getCell(col).border = { top: { style: 'thin' } };
    }
  }
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
