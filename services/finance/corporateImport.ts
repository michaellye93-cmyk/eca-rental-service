import type {FinanceExpense, QualityIssue} from '../../types/finance.ts';
import type {WorkbookSheet} from './imports.ts';

const key=(value:unknown)=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const corporateAliases:Record<string,string[]>={
  frequency:['frequency'],start_month:['startmonth'],end_month:['endmonth'],billing_date:['expensedate','billingdate','date'],
  amount:['amountrm','amount','expenseamount','monthlyamount','cost','total'],category:['category','costtype'],
  description:['description','note','notes'],supplier:['payee','supplier','vendor','workshop'],reference:['reference','invoiceno','receiptno'],source:['source'],notes:['notes','note'],plate_key:['carplate','plate','vehicleplate','registrationno'],
};
const categories=['Office Rental','Accounting Fee','Salary','KWSP','PERKESO','PCB','Utilities','Internet','Professional Fees','General Software','Other Corporate Cost'];
const categoryNames=new Map(categories.map(name=>[key(name),name]));
for(const [alias,name] of [['Software','General Software'],['Internet / Unifi','Internet'],['Utilities - Electric','Utilities'],['EPF / KWSP','KWSP'],['SOCSO / PERKESO','PERKESO'],['Indah Water','Utilities']])categoryNames.set(key(alias),name);
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function cell(raw:unknown):unknown {return raw&&typeof raw==='object'&&('formula' in raw||'sharedFormula' in raw)?cell('result' in raw?raw.result:null):raw;}
const text=(raw:unknown)=>String(cell(raw)??'').trim();
function date(raw:unknown):string|null {
  raw=cell(raw);let result:string;
  if(raw instanceof Date&&!Number.isNaN(raw.getTime()))result=raw.toISOString().slice(0,10);
  else if(typeof raw==='number'&&raw>1&&raw<100000)result=new Date(Date.UTC(1899,11,30+raw)).toISOString().slice(0,10);
  else {result=text(raw);const slash=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(result);if(slash)result=`${slash[3]}-${slash[2].padStart(2,'0')}-${slash[1].padStart(2,'0')}`;}
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(result)?new Date(`${result}T00:00:00Z`):null;
  return parsed&&!Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===result?result:null;
}
function month(raw:unknown):string|null {
  const actual=date(raw);if(actual)return `${actual.slice(0,7)}-01`;
  const value=text(raw);if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return `${value}-01`;
  const named=/^([a-z]+)[\s-]+(\d{4})$/i.exec(value);if(!named)return null;
  const index=months.findIndex(m=>m===named[1].toLowerCase()||m.slice(0,3)===named[1].toLowerCase());return index<0?null:`${named[2]}-${String(index+1).padStart(2,'0')}-01`;
}
export function parseCorporateSheet(sheet:WorkbookSheet,selected:string){
  const rows:Array<FinanceExpense&{source_row:number;sheet_name:string}>=[],issues:QualityIssue[]=[];let total_amount=0,skipped_rows=0;
  const header=(field:string)=>corporateAliases[field].map(alias=>sheet.headers.find(h=>key(h)===alias)).find(Boolean);
  for(const [field,label] of [['amount','Amount (RM)'],['category','Category']])if(!header(field))issues.push({code:'MISSING_REQUIRED_HEADER',severity:'error',detail:`Workbook is missing required ${label} column`});
  for(const raw of sheet.rows){
    const get=(field:string)=>cell(raw.values[header(field)??'']);const errors:string[]=[];
    const frequencyKey=header('frequency')?key(get('frequency')):'oneoff';
    const frequency=frequencyKey==='monthlyrecurring'?'MONTHLY_RECURRING':frequencyKey==='oneoff'?'ONE_OFF':null;
    const start=frequency==='MONTHLY_RECURRING'?month(get('start_month')):null,end=frequency==='MONTHLY_RECURRING'?month(get('end_month')):null;
    const billing=date(get('billing_date'));
    if(frequency==='MONTHLY_RECURRING'){
      if(!start)errors.push('Enter a valid Start Month.');
      if(text(get('end_month'))&&!end)errors.push('Enter a valid End Month.');
      if(start&&end&&end<start)errors.push('End Month must be on or after Start Month.');
      if(text(get('billing_date'))&&!billing)errors.push('Enter a valid Expense Date or leave it blank.');
    }else if(frequency==='ONE_OFF'){
      if(!billing||billing.slice(0,7)!==selected.slice(0,7))errors.push('Enter a valid Expense Date in the selected Finance month.');
    }else errors.push('Frequency must be Monthly Recurring or One-off.');
    const rawAmount=text(get('amount'));const amount=rawAmount?Number(rawAmount.replace(/^RM\s*/i,'').replace(/,/g,'')):Number.NaN;
    if(!Number.isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>1e-7)errors.push('Amount (RM) must be non-negative with at most two decimal places.');
    const rawCategory=text(get('category')),category=categoryNames.get(key(rawCategory));
    if(!category)errors.push(`Choose an approved Category${rawCategory?`: ${rawCategory}`:''}.`);
    if(text(get('plate_key')))errors.push('Shared Opex cannot have a vehicle plate.');
    for(const detail of errors)issues.push({code:'INVALID_CORPORATE_EXPENSE',severity:'error',detail:`Row ${raw.source_row}: ${detail}`,source_id:`${raw.sheet_name}:${raw.source_row}`});
    if(!errors.length&&frequency==='MONTHLY_RECURRING'&&(start!>selected||(end&&end<selected))){skipped_rows++;continue;}
    rows.push({source_row:raw.source_row,sheet_name:raw.sheet_name,finance_month:selected,billing_date:billing,plate_key:null,category:category??rawCategory,payment_source:'Corporate Opex',supplier:text(get('supplier'))||null,amount,reference:text(get('reference'))||null,description:text(get('description'))||null,frequency:frequency??undefined,start_month:start,end_month:end,source:text(get('source'))||null,notes:text(get('notes'))||null});
    if(!errors.length)total_amount+=amount;
  }
  if(!sheet.rows.length)issues.push({code:'EMPTY_REPORT',severity:'error',detail:'Workbook contains no Shared Opex rows.'});
  return {rows,issues,total_amount:Math.round(total_amount*100)/100,skipped_rows};
}
