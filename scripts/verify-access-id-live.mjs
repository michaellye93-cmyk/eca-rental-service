// Opt-in smoke test: authenticates the existing Admin, opens Finance, and revokes
// only its own test session. No imports, raw refreshes, or financial edits.
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { expectFitsViewport, expectNoTechnicalLabels } from './finance-ux-browser-checks.mjs';

const { ACCESS_LOGIN_TEST_ID, ACCESS_LOGIN_TEST_USER_ID, FINANCE_PLAYWRIGHT_MODULE }=process.env;
if(!ACCESS_LOGIN_TEST_ID||!ACCESS_LOGIN_TEST_USER_ID||!FINANCE_PLAYWRIGHT_MODULE)throw new Error('Explicit test credentials and Playwright path are required.');
const env=loadEnv('production',process.cwd(),'VITE_');
const {chromium}=await import(pathToFileURL(FINANCE_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:1080}});
const page=await context.newPage();
const errors=[];let session;
page.on('pageerror',error=>errors.push(error.message));
await context.route('https://*.supabase.co/**',async route=>{
 const request=route.request(),path=new URL(request.url()).pathname;
 if(!['GET','OPTIONS'].includes(request.method())&&!['/functions/v1/access-id-login','/rest/v1/rpc/finance_access','/rest/v1/rpc/finance_read_month','/rest/v1/rpc/finance_workspace_meta','/auth/v1/token'].includes(path))throw new Error('Unexpected live mutation: '+path);
 await route.continue();
});
try{
 await page.goto(process.env.FINANCE_TEST_URL||'https://eca-rental-service.vercel.app');
 const loginResponse=page.waitForResponse(response=>response.url().endsWith('/functions/v1/access-id-login'));
 await page.getByPlaceholder('Access ID',{exact:true}).fill(ACCESS_LOGIN_TEST_ID);
 await page.getByRole('button',{name:'Login',exact:true}).click();
 const response=await loginResponse;
 assert.equal(response.status(),200);session=await response.json();
 const userResponse=await fetch(env.VITE_SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.VITE_SUPABASE_ANON_KEY,authorization:'Bearer '+session.access_token}});
 assert.equal(userResponse.status,200);assert.equal((await userResponse.json()).id,ACCESS_LOGIN_TEST_USER_ID);
 await page.getByRole('button',{name:'Finance',exact:true}).click();
 await page.getByRole('heading',{name:'Management P&L',exact:true,level:1}).waitFor();
 assert.equal(await page.locator('input[type=password]').count(),0);
 assert.equal(await page.getByRole('heading',{name:'Finance sign in'}).count(),0);
 await page.reload();
 await page.getByRole('button',{name:'Finance',exact:true}).click();
 await page.getByRole('heading',{name:'Management P&L',exact:true,level:1}).waitFor();
 const dir=new URL('../.local-tools/finance-ui/',import.meta.url);await mkdir(dir,{recursive:true});
 const finance=page.locator('main.finance-workspace');
 const navigate=name=>page.getByRole('navigation',{name:'Finance sections'}).getByRole('button',{name,exact:true}).click();
 await page.getByRole('heading',{name:'Business performance',exact:true}).waitFor();
 assert.equal(await finance.locator('input[type=file]').count(),0);
 await expectNoTechnicalLabels(finance);
 await page.screenshot({path:fileURLToPath(new URL('live-single-login.png',dir)),fullPage:true});
 await navigate('Month Close');
 for(const name of ['E-Hailing revenue','Smart Drive Sales Report','Workshop billing','Other vehicle costs','Shared / corporate opex'])await page.getByRole('heading',{name,exact:true}).waitFor();
 assert.equal(await finance.locator('input[type=file]').count(),4);
 await expectNoTechnicalLabels(finance);
 await page.screenshot({path:fileURLToPath(new URL('live-month-close.png',dir)),fullPage:true});
 await navigate('Settings');await page.getByRole('heading',{name:'Vehicle Master',exact:true}).waitFor();
 const vehicleSelect=page.getByLabel('Existing record',{exact:true});
 if(!await vehicleSelect.isDisabled()&&await vehicleSelect.locator('option').count()>1){
  await vehicleSelect.selectOption({index:1});
  const selectedPlate=await vehicleSelect.locator('option:checked').innerText();
  assert.equal(await page.getByLabel('Car plate',{exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Delete vehicle',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:`Delete ${selectedPlate}?`,exact:true});
  await confirmation.waitFor();assert.match(await confirmation.innerText(),/Past revenue, expenses and closed reports are retained/);
  await page.screenshot({path:fileURLToPath(new URL('live-delete-confirmation.png',dir)),fullPage:true});
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await vehicleSelect.locator('option:checked').innerText(),selectedPlate);
 }
 await page.getByRole('button',{name:'Monthly Vehicle Costs',exact:true}).click();await page.getByRole('heading',{name:'Monthly Vehicle Costs',exact:true}).waitFor();
 await page.getByRole('button',{name:'Insurance',exact:true}).click();await page.getByRole('heading',{name:'Insurance',exact:true}).waitFor();
 assert.deepEqual(await page.getByLabel('Responsibility',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value)),['','ECA_PAID','OWNER_PAID']);
 await page.getByLabel('Premium (RM)',{exact:true}).waitFor();await page.getByLabel('Coverage end',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Payment date (optional)',{exact:true}).count(),0);
 await expectNoTechnicalLabels(finance);
 await navigate('Overview');await page.setViewportSize({width:390,height:844});await expectFitsViewport(page,finance);
 await navigate('Month Close');await expectFitsViewport(page,finance);
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Audit Details',exact:true}).click();await page.getByRole('heading',{name:'Audit details',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.screenshot({path:fileURLToPath(new URL('live-month-close-mobile.png',dir)),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS live browser: existing Admin identity, single Access ID login and reload, Overview, five Month Close sections, Settings and delete confirmation/cancel, mobile navigation/Audit, no second login or page errors. No financial inputs changed.');
}finally{
 await context.close();await browser.close();
 if(session?.access_token){
  const logout=await fetch(env.VITE_SUPABASE_URL+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,authorization:'Bearer '+session.access_token}});
  assert.equal(logout.status,204,'Test session must be revoked without affecting other sessions');
 }
}
