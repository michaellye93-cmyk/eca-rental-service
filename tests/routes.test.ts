import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminPath, parseAdminPath, resolveAdminRoute, routeFromStored, type AdminRoute } from '../services/routes.ts';

test('each page has its own address, and the address reads back as the same page', () => {
  const table: [string, AdminRoute][] = [
    ['/drivers', { kind: 'drivers' }],
    ['/fleet', { kind: 'fleet' }],
    ['/agreements', { kind: 'agreements' }],
    ['/finance/cash', { kind: 'finance', page: 'cash' }],
    ['/finance/collections', { kind: 'finance', page: 'collections' }],
    ['/finance/overview', { kind: 'finance', page: 'overview' }],
    ['/finance/vehicles', { kind: 'finance', page: 'vehicles' }],
    ['/finance/close', { kind: 'finance', page: 'close' }],
    ['/finance/records', { kind: 'finance', page: 'expenses' }],
    ['/finance/reconcile', { kind: 'finance', page: 'reconcile' }],
    ['/admin/collections', { kind: 'collections' }],
    ['/admin/worklist', { kind: 'worklist' }],
    ['/drivers/XAA1001', { kind: 'drivers', plate: 'XAA1001' }],
    ['/drivers/XAA1001/pay', { kind: 'drivers', plate: 'XAA1001', action: 'pay' }],
    ['/drivers/XAA1001/statement', { kind: 'drivers', plate: 'XAA1001', action: 'statement' }],
  ];
  for (const [path, route] of table) {
    assert.deepEqual(parseAdminPath(path), route, `parse ${path}`);
    assert.equal(buildAdminPath(route), path, `build ${path}`);
  }
});

test('plates are matched however they are typed; trailing slashes and old spellings are accepted', () => {
  assert.deepEqual(parseAdminPath('/drivers/xaa%201001/'), { kind: 'drivers', plate: 'XAA1001' });
  assert.deepEqual(parseAdminPath('/drivers/xaa1001/PAY'), { kind: 'drivers', plate: 'XAA1001', action: 'pay' });
  assert.deepEqual(parseAdminPath('/drivers/XAA1001/unknown'), { kind: 'drivers', plate: 'XAA1001' });
  assert.deepEqual(parseAdminPath('/drivers/%E0%A4%A'), { kind: 'drivers' }, 'an unreadable plate shows the list');
  assert.deepEqual(parseAdminPath('/finance/expenses'), { kind: 'finance', page: 'expenses' });
  assert.deepEqual(parseAdminPath('/finance'), { kind: 'finance', page: null });
  assert.deepEqual(parseAdminPath('/finance/nonsense'), { kind: 'finance', page: null });
  assert.deepEqual(parseAdminPath('/admin/collections/'), { kind: 'collections' });
  assert.equal(buildAdminPath({ kind: 'drivers', plate: 'xaa 1001', action: 'pay' }), '/drivers/XAA1001/pay');
  for (const path of ['/', '', '/admin', '/admin/', '/somewhere-else', '/admin/other']) assert.deepEqual(parseAdminPath(path), { kind: 'home' }, path);
});

test('the old saved tab still picks the first page when the address is just "/" or "/admin"', () => {
  assert.deepEqual(routeFromStored({ section: null, moneyPage: null, legacyView: null }), { kind: 'drivers' });
  assert.deepEqual(routeFromStored({ section: 'FLEET', moneyPage: null, legacyView: null }), { kind: 'fleet' });
  assert.deepEqual(routeFromStored({ section: 'AGREEMENTS', moneyPage: 'cash', legacyView: null }), { kind: 'agreements' });
  assert.deepEqual(routeFromStored({ section: 'MONEY', moneyPage: 'reconcile', legacyView: null }), { kind: 'finance', page: 'reconcile' });
  assert.deepEqual(routeFromStored({ section: 'MONEY', moneyPage: 'nonsense', legacyView: null }), { kind: 'finance', page: 'cash' });
  // Tabs saved before the Drivers section existed
  assert.deepEqual(routeFromStored({ section: 'ANALYTICS', moneyPage: null, legacyView: null }), { kind: 'finance', page: 'collections' });
  assert.deepEqual(routeFromStored({ section: null, moneyPage: null, legacyView: 'RECONCILE' }), { kind: 'finance', page: 'reconcile' });
  assert.deepEqual(routeFromStored({ section: null, moneyPage: null, legacyView: 'DELISTED' }), { kind: 'drivers' });
  assert.deepEqual(routeFromStored({ section: 'GARBAGE', moneyPage: null, legacyView: null }), { kind: 'drivers' });
});

test('signed-in pages resolve to a real page: "/" from the saved tab, Finance for admins only', () => {
  const stored = { section: 'MONEY', moneyPage: 'close', legacyView: null };
  assert.deepEqual(resolveAdminRoute({ kind: 'home' }, true, stored), { kind: 'finance', page: 'close' });
  assert.deepEqual(resolveAdminRoute({ kind: 'home' }, false, stored), { kind: 'drivers' }, 'staff never land on Finance');
  assert.deepEqual(resolveAdminRoute({ kind: 'finance', page: 'cash' }, false, stored), { kind: 'drivers' });
  assert.deepEqual(resolveAdminRoute({ kind: 'finance', page: null }, true, stored), { kind: 'finance', page: 'close' }, '/finance opens the last Finance page');
  assert.deepEqual(resolveAdminRoute({ kind: 'finance', page: null }, true, { section: null, moneyPage: null, legacyView: null }), { kind: 'finance', page: 'cash' });
  assert.deepEqual(resolveAdminRoute({ kind: 'worklist' }, false, stored), { kind: 'worklist' }, 'staff use the worklist');
  assert.deepEqual(resolveAdminRoute({ kind: 'collections' }, false, stored), { kind: 'collections' }, 'the data view keeps its own admin check');
  assert.deepEqual(resolveAdminRoute({ kind: 'drivers', plate: 'XAA1001', action: 'pay' }, false, stored), { kind: 'drivers', plate: 'XAA1001', action: 'pay' });
});
