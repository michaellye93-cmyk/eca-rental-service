import type {Insurance, QualityIssue} from '../../types/finance.ts';
import type {WorkbookSheet} from './imports.ts';
import {normalizeInsuranceResponsibility, insuranceProblems, insuranceStatus, insuranceCashOutflow, ownerPremiumReview} from './insurance.ts';

export const insuranceAliases: Record<string,string[]> = {
  plate_key:['carplate','plate','vehicleplate','registrationno'], premium:['premiumrm','premium','insurancepremium','cashamountrm','cashamount'],
  responsibility:['responsibility','responsiblity'], coverage_start:['coveragestart'], coverage_end:['coverageend'],
  supplier:['supplierpayee','supplier','payee'], reference:['reference'], source:['source'], cost_type:['costtype'],
};
const key=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const header=(sheet:WorkbookSheet,field:string)=>insuranceAliases[field]?.map(alias=>sheet.headers.find(h=>key(h)===alias)).find(Boolean);
function date(raw:unknown):string|null {
  // Excel may omit the cached result of a formula that displays a blank cell.
  if(raw && typeof raw==='object' && ('formula' in raw || 'sharedFormula' in raw))return date('result' in raw?raw.result:null);
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0,10);
  if (typeof raw==='number' && raw>1 && raw<100000) return new Date(Date.UTC(1899,11,30+raw)).toISOString().slice(0,10);
  const text=String(raw??'').trim();if(!text)return null;
  const slash=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if(slash)return `${slash[3]}-${slash[2].padStart(2,'0')}-${slash[1].padStart(2,'0')}`;
  const named=/^(\d{1,2})[- ]([a-z]+)[- ](\d{4})$/i.exec(text);
  if(named){const months=['january','february','march','april','may','june','july','august','september','october','november','december'];const month=months.findIndex(m=>named[2].toLowerCase()===m||named[2].toLowerCase()===m.slice(0,3));if(month>=0)return `${named[3]}-${String(month+1).padStart(2,'0')}-${named[1].padStart(2,'0')}`;}
  return text;
}
function premium(raw:unknown):number {
  const text=String(raw??'').trim();return text ? Number(text.replace(/^RM\s*/i,'').replace(/,/g,'')) : Number.NaN;
}
export interface InsuranceSummary {records:number;total_eca_premium:number;valid_eca_policies:number;future_eca_renewals:number;owner_paid_no_cost:number;review_items:number}
export function parseInsuranceSheet(sheet:WorkbookSheet,knownVehicles:Set<string>) {
  const rows:Array<Insurance & {source_row:number;sheet_name:string}>=[],issues:QualityIssue[]=[];
  const summary:InsuranceSummary={records:0,total_eca_premium:0,valid_eca_policies:0,future_eca_renewals:0,owner_paid_no_cost:0,review_items:0};
  for(const field of ['plate_key','premium','responsibility'])if(!header(sheet,field))issues.push({code:'MISSING_REQUIRED_HEADER',severity:'error',detail:`Workbook is missing required ${field==='premium'?'Premium (RM)':field==='plate_key'?'Car Plate':'RESPONSIBILITY'} column`});
  for(const raw of sheet.rows){
    const get=(field:string)=>{const name=header(sheet,field);return name?raw.values[name]:null;};
    if(header(sheet,'cost_type')&&String(get('cost_type')??'').trim().toLowerCase()!=='insurance')continue;
    const plate=String(get('plate_key')??'').toUpperCase().replace(/\s/g,'');
    const row={plate_key:plate,premium:premium(get('premium')),coverage_start:date(get('coverage_start')),coverage_end:date(get('coverage_end')),responsibility:normalizeInsuranceResponsibility(get('responsibility')),payment_date:null,supplier:String(get('supplier')??'').trim()||null,reference:String(get('reference')??'').trim()||null,source:String(get('source')??'').trim()||null,source_row:raw.source_row,sheet_name:raw.sheet_name} as Insurance & {source_row:number;sheet_name:string};
    const errors=insuranceProblems(row);if(!knownVehicles.has(plate))errors.push('Car Plate must exist in Finance Vehicle Master.');
    for(const detail of errors)issues.push({code:!row.responsibility&&detail.includes('responsibility')?'INVALID_INSURANCE_RESPONSIBILITY':'INVALID_INSURANCE',severity:'error',detail:`Row ${raw.source_row}: ${detail}`,plate_key:plate,source_id:`${raw.sheet_name}:${raw.source_row}`});
    const status=insuranceStatus(row);
    if(row.responsibility==='OWNER_PAID'&&row.premium>0)issues.push({code:'INSURANCE_NEEDS_REVIEW',severity:'warning',detail:ownerPremiumReview,plate_key:plate,source_id:`${raw.sheet_name}:${raw.source_row}`});
    if(errors.length||status==='Needs Review')summary.review_items++;
    else if(status==='ECA Paid'){summary.valid_eca_policies++;summary.total_eca_premium+=row.premium;}
    else if(status==='Future ECA Renewal Responsibility')summary.future_eca_renewals++;
    else summary.owner_paid_no_cost++;
    row.payment_date=errors.length?null:insuranceCashOutflow(row).date;
    rows.push(row);
  }
  summary.records=rows.length;summary.total_eca_premium=Math.round(summary.total_eca_premium*100)/100;
  if(!rows.length){issues.push({code:'EMPTY_REPORT',severity:'error',detail:'Workbook contains no Insurance rows.'});summary.review_items=issues.length;}
  return {rows,issues,summary};
}
