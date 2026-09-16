import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

// Called by the isolated SQL/browser harness. These writes never reach Supabase.
export async function verifySmartDriveRevalidation({page,db,save,testControl}) {
  const section=page.locator('.finance-close-section').filter({has:page.getByRole('heading',{name:'Smart Drive Sales Report',exact:true})});
  const fileInput=section.locator('input[type=file]');
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Sales');
  sheet.addRow(['Car Plate','Start Date','End Date','Revenue','Commission Paid','Status']);
  for(let i=0;i<89;i++)sheet.addRow([i<60?'LATE 123':'NEXT 123','2026-08-01','2026-08-02',10,1,'Completed']);
  const file={name:'same-89-sales.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())};
  const dialog=page.getByRole('dialog',{name:'Review same-89-sales.xlsx',exact:true});
  const select=async()=>{await fileInput.setInputFiles(file);await dialog.waitFor();await dialog.getByRole('button',{name:'Approve and post',exact:true}).waitFor();assert.equal(await fileInput.inputValue(),'','Same-file selection must reset the native input');};
  await select();assert.match(await dialog.innerText(),/0 matched rows · 89 unmatched rows/);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await save('vehicle',{plate_key:'LATE123',display_plate:'LATE 123',business_unit:'DAILY RENTAL',ownership_type:'Owned',status:'Active'});
  await select();
  assert.match(await dialog.innerText(),/60 matched rows · 29 unmatched rows/,'Reselecting identical bytes must fetch the newly added vehicle, even when the page still holds the older master');
  assert.match(await dialog.innerText(),/1 matched vehicles · 1 unmatched vehicles/);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await save('vehicle',{plate_key:'NEXT123',display_plate:'NEXT 123',business_unit:'DAILY RENTAL',ownership_type:'Owned',status:'Active'});
  await section.getByRole('button',{name:'Review selected file',exact:true}).click();
  await dialog.getByText('89 matched rows · 0 unmatched rows',{exact:true}).waitFor();
  assert.match(await dialog.innerText(),/2 matched vehicles · 0 unmatched vehicles/);
  await db.exec("reset role; update finance_private.vehicles set plate_key='EDITED123',display_plate='EDITED 123' where plate_key='NEXT123';");
  await dialog.getByRole('button',{name:'Revalidate',exact:true}).click();
  await dialog.getByText('60 matched rows · 29 unmatched rows',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Approve and post',exact:true}).isDisabled(),true);
  await db.exec("reset role; update finance_private.vehicles set plate_key='NEXT123',display_plate='NEXT 123' where plate_key='EDITED123';");
  await dialog.getByRole('button',{name:'Revalidate',exact:true}).click();
  await dialog.getByText('89 matched rows · 0 unmatched rows',{exact:true}).waitFor();
  testControl.failNextMonthRead=true;
  await dialog.getByRole('button',{name:'Revalidate',exact:true}).click();
  await dialog.getByText('Test master refresh unavailable',{exact:false}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Approve and post',exact:true}).isDisabled(),true,'A failed refresh must never authorize stale preview results');
  await dialog.getByRole('button',{name:'Revalidate',exact:true}).click();
  await dialog.getByText('89 matched rows · 0 unmatched rows',{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Approve and post',exact:true}).isDisabled(),false);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await db.exec("reset role; delete from finance_private.vehicles where plate_key in ('LATE123','NEXT123');");
  assert.equal((await db.query('select count(*)::integer n from finance_private.imports')).rows[0].n,0,'Revalidation must not post imports');
  console.log('PASS Smart Drive revalidation: same 89-row file reflects added/edited masters on reselect, reopen and Revalidate; distinct counts; failed refresh blocks approval; input reset; no import posted.');
}
