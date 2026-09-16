import assert from 'node:assert/strict';

export async function expectNoTechnicalLabels(scope) {
  const text=await scope.innerText();
  assert.doesNotMatch(text,/plate_key|refreshed_at|MISSING_REFRESHED_AT|MISSING_SMART_IMPORT|source_payment_id|source_row|finance_month/,'Normal Finance screens must use business labels');
}

export async function expectFitsViewport(page, scope) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The whole document must fit the viewport');
  const result=await scope.evaluate(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,viewport:window.innerWidth}));
  assert.ok(result.left>=-1 && result.right<=result.viewport+1,`Finance content must fit its viewport: ${JSON.stringify(result)}`);
  const overflowing=await scope.locator('input:not([type=hidden]),select,textarea,button').evaluateAll(elements=>elements.filter(el=>{
    if(!el.getClientRects().length)return false;
    const rect=el.getBoundingClientRect();
    // Horizontal navigation and tables may scroll within their own container.
    for(let parent=el.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(['auto','scroll'].includes(style.overflowX))return false;}
    return rect.right>window.innerWidth+2 || rect.left < -2;
  }).map(el=>el.getAttribute('aria-label')||el.textContent?.trim()||el.tagName));
  assert.deepEqual(overflowing,[],'Form controls must fit on mobile');
}

export async function announceAuthRefresh(page, event) {
  const revalidated=page.waitForResponse(response=>response.url().endsWith('/rest/v1/rpc/finance_access'));
  await page.evaluate(event=>{
    const key=Object.keys(localStorage).find(key=>/^sb-.*-auth-token$/.test(key));
    if(!key)throw new Error('Expected the isolated fixture session');
    const channel=new BroadcastChannel(key);
    channel.postMessage({event,session:JSON.parse(localStorage.getItem(key))});channel.close();
  },event);
  await revalidated;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
