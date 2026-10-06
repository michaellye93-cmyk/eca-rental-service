import type ExcelJS from 'exceljs';

/**
 * The Excel library is large, so it is downloaded only when a workbook is actually read or written (a bank
 * statement, an import or an export), not when the Finance page opens.
 */
export async function newWorkbook(): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import('exceljs');
  return new Excel.Workbook();
}
