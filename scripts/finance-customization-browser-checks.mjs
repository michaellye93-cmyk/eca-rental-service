import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handleAccessIdLogin, hashAccessId } from "../supabase/functions/access-id-login/handler.ts";
import {
  expectFitsViewport,
  expectNoTechnicalLabels,
} from "./finance-ux-browser-checks.mjs";

const playwrightPath = process.env.FINANCE_PLAYWRIGHT_MODULE;
if (!playwrightPath)
  throw new Error(
    "Set FINANCE_PLAYWRIGHT_MODULE to the installed playwright/index.mjs path.",
  );
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const output = new URL("../.local-tools/finance-customization-ui/", import.meta.url);
await mkdir(output, { recursive: true });

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000003";
const ids = {
  vehicle: "10000000-0000-4000-8000-000000000001",
  payout: "20000000-0000-4000-8000-000000000001",
  workshopExpense: "30000000-0000-4000-8000-000000000001",
  fixedExpense: "30000000-0000-4000-8000-000000000002",
  fixedTemplate: "40000000-0000-4000-8000-000000000001",
  workshopSummary: "50000000-0000-4000-8000-000000000001",
  otherIncome: "60000000-0000-4000-8000-000000000001",
  upload: "70000000-0000-4000-8000-000000000001",
};

const state = {
  month: {
    finance_month: "2026-08-01",
    status: "DRAFT",
    revision: 7,
    refreshed_at: "2026-08-31T00:00:00Z",
    frozen_at: null,
    source_count: 1,
    total_cash: 1200,
    total_claim: 0,
    earliest_date: "2026-08-01",
    latest_date: "2026-08-01",
  },
  vehicles: [
    {
      vehicle_id: ids.vehicle,
      plate_key: "ABC123",
      display_plate: "ABC 123",
      model: "Fixture Sedan",
      business_unit: "E-HAILING",
      ownership_type: "Company owned",
      status: "Active",
      deleted_at: null,
    },
  ],
  vehicle_plate_history: [],
  recurring_costs: [
    {
      id: ids.payout,
      obligation_id: ids.payout,
      version_no: 1,
      record_version: 1,
      plate_key: "ABC123",
      start_month: "2026-08-01",
      end_month: null,
      cost_type: "Owner Payout",
      monthly_amount: 800,
      payee: "Fixture Owner",
      notes: "Imported fixture payout",
      source_upload_id: ids.upload,
      cancelled_at: null,
    },
  ],
  insurance: [],
  expenses: [
    {
      id: ids.workshopExpense,
      finance_month: "2026-08-01",
      billing_date: "2026-08-12",
      plate_key: "ABC123",
      category: "Service & Maintenance",
      payment_source: "Workshop Billing",
      supplier: "Fixture Workshop",
      amount: 320,
      reference: "WS-101",
      description: "Imported workshop fixture",
      frequency: "ONE_OFF",
      start_month: null,
      end_month: null,
      source: "fixture-workshop.xlsx",
      notes: null,
      record_version: 1,
      source_upload_id: ids.upload,
      fixed_cost_template_id: null,
      cancelled_at: null,
    },
    {
      id: ids.fixedExpense,
      finance_month: "2026-08-01",
      billing_date: null,
      plate_key: null,
      category: "Office Rental",
      payment_source: "Corporate Opex",
      supplier: "Fixture Property",
      amount: 1100,
      reference: null,
      description: "Monthly office rental",
      frequency: "MONTHLY_RECURRING",
      start_month: "2026-01-01",
      end_month: null,
      source: "Manual / Fixed Operating Cost",
      notes: "Fixture lease",
      record_version: 1,
      source_upload_id: null,
      fixed_cost_template_id: ids.fixedTemplate,
      cancelled_at: null,
    },
  ],
  fixed_cost_templates: [
    {
      id: ids.fixedTemplate,
      series_id: ids.fixedTemplate,
      version_no: 1,
      category: "Office Rental",
      monthly_amount: 1100,
      effective_from: "2026-01-01",
      effective_until: null,
      payee: "Fixture Property",
      note: "Fixture lease",
      source: "Manual / Fixed Operating Cost",
      linked_expense_id: ids.fixedExpense,
      record_version: 1,
      cancelled_at: null,
    },
  ],
  workshop_summaries: [
    {
      id: ids.workshopSummary,
      finance_month: "2026-08-01",
      business_unit: null,
      amount: 500,
      supplier: "Fixture Workshop Group",
      reference: "AUG-TOTAL",
      note: "Fixture monthly total",
      allocated_amount: 0,
      unallocated_amount: 500,
      record_version: 1,
      cancelled_at: null,
    },
  ],
  other_income: [
    {
      id: ids.otherIncome,
      finance_month: "2026-08-01",
      status: "CONFIRMED",
      income_type: "Insurance rebate",
      amount: 125,
      plate_key: "ABC123",
      business_unit: "E-HAILING",
      receipt_date: "2026-08-20",
      reference: "REBATE-1",
      notes: "Fixture rebate",
      source: "Manual / Other Income",
      confirmation_key: "fixture-rebate",
      record_version: 1,
      cancelled_at: null,
    },
  ],
  ehailing: [
    {
      source_payment_id: "80000000-0000-4000-8000-000000000001",
      driver_id: null,
      driver_name_snapshot: "Fixture Driver",
      car_plate_snapshot: "ABC 123",
      plate_key: "ABC123",
      payment_date: "2026-08-01",
      cash_amount: 1200,
      service_claim: 0,
      gross_rental_revenue: 1200,
      payment_method: "BANK TRANSFER",
      refreshed_at: "2026-08-31T00:00:00Z",
      finance_month: "2026-08-01",
      attribution_changed: false,
    },
  ],
  smart_import: null,
  smart_rows: [],
  imports: [],
  bank_imports: [],
  bank_rows: [],
  bootstrap_completed: true,
  calculation_version: 3,
};

const workspaceMeta = {
  reviews: [
    { section: "workshop", decision: "MISSING", reviewed_at: null, valid: false },
    { section: "vehicle_expense", decision: "MISSING", reviewed_at: null, valid: false },
    { section: "corporate_expense", decision: "MISSING", reviewed_at: null, valid: false },
    { section: "other_income", decision: "REVIEWED", reviewed_at: "2026-08-31T00:00:00Z", valid: true },
  ],
  uploads: [
    {
      id: ids.upload,
      kind: "recurring_cost",
      filename: "fixture-monthly-payout.xlsx",
      imported_at: "2026-08-01T00:00:00Z",
      row_count: 1,
      total_amount: 800,
      status: "POSTED",
      source_audit: [],
    },
  ],
};

const clone = (value) => structuredClone(value);
let generatedId = 10;
const nextId = (prefix) =>
  `${prefix}${String(++generatedId).padStart(12, "0")}`;
const touch = () => {
  state.month.revision += 1;
};
const active = (rows) => rows.filter((row) => !row.cancelled_at);
const refreshWorkshopAmounts = () => {
  for (const row of state.workshop_summaries) {
    row.unallocated_amount = Number(row.amount) - Number(row.allocated_amount || 0);
  }
};

const testControl = { failNextRpc: null };
const calls = [];

function mutateRecord(payload) {
  const { p_kind: kind, p_action: action, p_record: record } = payload;
  if (kind === "recurring_cost") {
    const found = state.recurring_costs.find((row) => row.id === record.id);
    if (action === "ADD")
      state.recurring_costs.push({
        ...record,
        id: nextId("21000000-0000-4000-8000-"),
        obligation_id: nextId("22000000-0000-4000-8000-"),
        version_no: 1,
        record_version: 1,
        cancelled_at: null,
      });
    else if (action === "CANCEL") Object.assign(found, { cancelled_at: new Date().toISOString() });
    else Object.assign(found, record, { record_version: (found.record_version ?? 1) + 1 });
  } else if (kind === "expense") {
    const found = state.expenses.find((row) => row.id === record.id);
    if (action === "ADD")
      state.expenses.push({
        ...record,
        id: nextId("31000000-0000-4000-8000-"),
        record_version: 1,
        cancelled_at: null,
      });
    else if (action === "CANCEL") Object.assign(found, { cancelled_at: new Date().toISOString() });
    else Object.assign(found, record, { record_version: (found.record_version ?? 1) + 1 });
  }
  touch();
  return clone(state);
}

function saveFixedCost(payload) {
  const { p_action: action, p_record: record, p_month: month } = payload;
  const found = state.fixed_cost_templates.find((row) => row.id === record.id);
  if (action === "ADD") {
    const id = nextId("41000000-0000-4000-8000-");
    const expenseId = nextId("32000000-0000-4000-8000-");
    state.fixed_cost_templates.push({
      ...record,
      id,
      series_id: id,
      version_no: 1,
      source: "Manual / Fixed Operating Cost",
      linked_expense_id: expenseId,
      record_version: 1,
      cancelled_at: null,
    });
    state.expenses.push({
      id: expenseId,
      finance_month: month,
      billing_date: null,
      plate_key: null,
      category: record.category,
      payment_source: "Corporate Opex",
      supplier: record.payee,
      amount: record.monthly_amount,
      reference: null,
      description: record.note,
      frequency: "MONTHLY_RECURRING",
      start_month: record.effective_from,
      end_month: record.effective_until,
      source: "Manual / Fixed Operating Cost",
      notes: record.note,
      fixed_cost_template_id: id,
      record_version: 1,
      cancelled_at: null,
    });
  } else if (action === "UPDATE_FUTURE") {
    Object.assign(found, record, {
      effective_from: month,
      record_version: found.record_version + 1,
    });
  } else if (action === "STOP") {
    found.effective_until = month;
  } else if (action === "DELETE") {
    found.cancelled_at = new Date().toISOString();
  }
  touch();
  return clone(state);
}

function saveWorkshopSummary(payload) {
  const { p_action: action, p_record: record } = payload;
  const found = state.workshop_summaries.find((row) => row.id === record.id);
  if (action === "ADD")
    state.workshop_summaries.push({
      ...record,
      id: nextId("51000000-0000-4000-8000-"),
      allocated_amount: 0,
      unallocated_amount: Number(record.amount),
      record_version: 1,
      cancelled_at: null,
    });
  else if (action === "UPDATE")
    Object.assign(found, record, { record_version: found.record_version + 1 });
  else found.cancelled_at = new Date().toISOString();
  refreshWorkshopAmounts();
  touch();
  return clone(state);
}

function saveOtherIncome(payload) {
  const { p_action: action, p_record: record } = payload;
  const found = state.other_income.find((row) => row.id === record.id);
  if (action === "ADD")
    state.other_income.push({
      ...record,
      id: nextId("61000000-0000-4000-8000-"),
      confirmation_key: nextId("fixture-"),
      record_version: 1,
      cancelled_at: null,
    });
  else if (action === "UPDATE")
    Object.assign(found, record, { record_version: found.record_version + 1 });
  else found.cancelled_at = new Date().toISOString();
  touch();
  return clone(state);
}

function dispatchRpc(name, payload) {
  calls.push({ name, payload: clone(payload) });
  if (testControl.failNextRpc === name) {
    testControl.failNextRpc = null;
    throw new Error("Fixture server rejected this save for review.");
  }
  if (name === "finance_access") return true;
  if (name === "finance_read_month") return clone(state);
  if (name === "finance_workspace_meta") return clone(workspaceMeta);
  if (name === "finance_mutate_record") return mutateRecord(payload);
  if (name === "finance_save_fixed_cost") return saveFixedCost(payload);
  if (name === "finance_save_workshop_summary") return saveWorkshopSummary(payload);
  if (name === "finance_save_other_income") return saveOtherIncome(payload);
  if (name === "finance_generate_fixed_costs") return clone(state);
  if (name === "finance_link_workshop_allocation") {
    const summary = state.workshop_summaries.find(
      (row) => row.id === payload.p_summary_id,
    );
    const expense = state.expenses.find((row) => row.id === payload.p_expense_id);
    summary.allocated_amount += expense.amount;
    refreshWorkshopAmounts();
    touch();
    return clone(state);
  }
  throw new Error(`Unimplemented isolated Finance RPC: ${name}`);
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const claims = () => ({
  sub: ADMIN_ID,
  role: "authenticated",
  session_id: SESSION_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  is_anonymous: false,
});
const token = () =>
  [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(JSON.stringify(claims())).toString("base64url"),
    "fixture",
  ].join(".");
const user = () => ({
  id: ADMIN_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "fixture-admin@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-08-01T00:00:00Z",
});
const accounts = [
  {
    access_id_sha256: await hashAccessId("fixture-admin"),
    user_id: ADMIN_ID,
    role: "admin",
  },
];

await context.route("https://*.supabase.co/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const fulfill = (body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  if (request.method() === "OPTIONS")
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      },
    });
  if (url.pathname === "/functions/v1/access-id-login") {
    const response = await handleAccessIdLogin(
      new Request(url, { method: "POST", body: request.postData() }),
      {
        accounts,
        callerBucket: `client:${"a".repeat(64)}`,
        consumeAttempt: async () => true,
        getAccount: async () => ({
          id: ADMIN_ID,
          email: "fixture-admin@example.test",
          role: "admin",
          is_anonymous: false,
        }),
        createSession: async () => ({
          user_id: ADMIN_ID,
          access_token: token(),
          refresh_token: "isolated-customization-refresh",
        }),
      },
    );
    return fulfill(await response.json(), response.status);
  }
  if (url.pathname === "/auth/v1/token")
    return fulfill({
      access_token: token(),
      refresh_token: "isolated-customization-refresh",
      expires_in: 3600,
      expires_at: claims().exp,
      token_type: "bearer",
      user: user(),
    });
  if (url.pathname === "/auth/v1/user") return fulfill(user());
  if (url.pathname === "/auth/v1/logout") return fulfill({});
  if (url.pathname === "/rest/v1/profiles") return fulfill({ role: "admin" });
  if (url.pathname.startsWith("/rest/v1/rpc/finance_")) {
    const name = url.pathname.split("/").pop();
    try {
      return fulfill(dispatchRpc(name, request.postDataJSON() ?? {}));
    } catch (error) {
      return fulfill({ message: error.message, code: "FIXTURE_REJECT" }, 400);
    }
  }
  if (request.method() !== "GET")
    throw new Error(`Unexpected external mutation: ${request.method()} ${url.pathname}`);
  return fulfill([]);
});

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const finance = () => page.locator("main.finance-workspace");
const navigate = (name) =>
  page
    .getByRole("navigation", { name: "Finance sections" })
    .getByRole("button", { name, exact: true })
    .click();
const rowWith = (text) => page.getByRole("row").filter({ hasText: text });
const checks = [];
const checked = (name) => checks.push(name);

try {
  await page.goto(process.env.FINANCE_TEST_URL ?? "http://127.0.0.1:4173");
  await page.getByPlaceholder("Access ID", { exact: true }).fill("fixture-admin");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.getByRole("button", { name: "Finance", exact: true }).click();
  await page.getByRole("heading", { name: "Management P&L", level: 1 }).waitFor();
  await expectNoTechnicalLabels(finance());
  let dialog;

  if (process.env.FINANCE_CHECK_PHASE !== "remaining") {
  await navigate("Settings");
  await page.getByRole("button", { name: "Monthly Vehicle Costs", exact: true }).click();
  await rowWith("Owner Payout").getByRole("button", { name: "Edit" }).click();
  const payoutDialog = page.getByRole("dialog", { name: "Edit monthly cost" });
  await payoutDialog.getByLabel("Monthly amount").fill("875");
  await payoutDialog.getByRole("button", { name: "Save changes" }).click();
  await payoutDialog.waitFor({ state: "hidden" });
  assert.equal(state.recurring_costs[0].monthly_amount, 875);
  assert.equal(state.recurring_costs[0].source_upload_id, ids.upload);
  checked("Imported monthly payout opened from its row and edited in place");

  await page.getByRole("button", { name: "Fixed Operating Costs", exact: true }).click();
  await page.getByRole("button", { name: "Add fixed cost", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add fixed operating cost" });
  await dialog.getByLabel("Category").fill("Accounting Fee");
  await dialog.getByLabel("Monthly amount (RM)").fill("250");
  await dialog.getByLabel("Payee").fill("Fixture Accountant");
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok(active(state.fixed_cost_templates).some((row) => row.category === "Accounting Fee"));
  checked("Fixed Operating Cost added from a dialog");

  await rowWith("Office Rental").getByRole("button", { name: "Edit future" }).click();
  dialog = page.getByRole("dialog", { name: "Edit future fixed cost" });
  await dialog.getByLabel("Monthly amount (RM)").fill("1150");
  if (await dialog.getByLabel("Reason for change").count())
    await dialog.getByLabel("Reason for change").fill("Fixture lease correction");
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(state.fixed_cost_templates[0].monthly_amount, 1150);
  checked("Fixed Operating Cost future version edited");

  await rowWith("Office Rental")
    .getByRole("button", { name: /Override 2026-08/ })
    .click();
  dialog = page.getByRole("dialog", { name: /Override Office Rental/ });
  await dialog.getByLabel("Amount (RM)").fill("1175");
  await dialog.getByRole("button", { name: "Save month override" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    state.expenses.find((row) => row.id === ids.fixedExpense).amount,
    1175,
  );
  checked("Fixed Operating Cost selected-month occurrence overridden");

  testControl.failNextRpc = "finance_save_fixed_cost";
  await page.getByRole("button", { name: "Add fixed cost", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add fixed operating cost" });
  await dialog.getByLabel("Category").fill("Server error fixture");
  await dialog.getByLabel("Monthly amount (RM)").fill("99");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture server rejected" }).waitFor();
  assert.equal(await dialog.getByLabel("Category").inputValue(), "Server error fixture");
  assert.equal(await dialog.getByLabel("Monthly amount (RM)").inputValue(), "99");
  checked("Rejected server save kept the dialog, values, and visible error");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.screenshot({
    path: fileURLToPath(new URL("fixed-operating-costs-desktop.png", output)),
    fullPage: true,
  });
  }

  await navigate("Expenses");
  const expensePanel = page
    .locator("section.finance-panel")
    .filter({ has: page.getByRole("heading", { name: "Workshop", exact: true }) })
    .last();
  await expensePanel
    .getByRole("row")
    .filter({ hasText: "Fixture Workshop" })
    .getByRole("button", { name: "Edit" })
    .click();
  dialog = page.getByRole("dialog", { name: "Edit expense" });
  await dialog.getByLabel("Supplier").fill("Edited Fixture Workshop");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    state.expenses.find((row) => row.id === ids.workshopExpense).supplier,
    "Edited Fixture Workshop",
  );
  checked("Imported workshop expense opened from its row and edited in place");

  await page.getByRole("tab", { name: "Monthly total", exact: true }).click();
  await rowWith("AUG-TOTAL").getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit monthly workshop total" });
  await dialog.getByLabel("Monthly total (RM)").fill("550");
  await dialog.getByLabel("Correction reason").fill("Fixture invoice total correction");
  await dialog.getByRole("button", { name: "Save monthly total" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(state.workshop_summaries[0].amount, 550);
  const summaryUpdate = calls.findLast(
    (call) => call.name === "finance_save_workshop_summary" && call.payload.p_action === "UPDATE",
  );
  assert.equal(summaryUpdate.payload.p_record.reason, "Fixture invoice total correction");
  checked("Workshop monthly total edited with an explicit audit reason");

  await page.getByRole("button", { name: "Add monthly total", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add monthly workshop total" });
  await dialog.getByLabel("Business unit").selectOption("DAILY RENTAL");
  await dialog.getByLabel("Monthly total (RM)").fill("75");
  await dialog.getByLabel("Reference").fill("AUG-DAILY");
  await dialog.getByRole("button", { name: "Save monthly total" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok(active(state.workshop_summaries).some((row) => row.reference === "AUG-DAILY"));
  checked("Workshop monthly total added");

  await page.screenshot({
    path: fileURLToPath(new URL("workshop-summary-desktop.png", output)),
    fullPage: true,
  });

  await navigate("Month Close");
  await rowWith("Insurance rebate").getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit Other Income" });
  await dialog.getByLabel("Description").fill("Edited fixture rebate");
  await dialog.getByRole("button", { name: "Save Other Income" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(state.other_income[0].notes, "Edited fixture rebate");
  checked("Other Income edited from its row");

  await page.getByRole("button", { name: "Add Other Income", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add Other Income" });
  await dialog.getByLabel("Source type").fill("Fixture refund");
  await dialog.getByLabel("Source record ID").fill("REFUND-2");
  await dialog.getByLabel("Amount (RM)").fill("45");
  await dialog.getByLabel("Vehicle").selectOption("ABC123");
  assert.equal(await dialog.getByLabel("Business unit").isDisabled(), true);
  assert.match(await dialog.innerText(), /derived from the selected vehicle: E-HAILING/i);
  await dialog.getByRole("button", { name: "Save Other Income" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok(active(state.other_income).some((row) => row.income_type === "Fixture refund"));
  checked("Other Income added with vehicle-derived business unit");

  await page.getByRole("button", { name: "Add Other Income", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add Other Income" });
  await dialog.getByLabel("Source type").fill("Mobile fixture income");
  await dialog.getByLabel("Amount (RM)").fill("10");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFitsViewport(page, dialog);
  await page.screenshot({
    path: fileURLToPath(new URL("other-income-mobile.png", output)),
    fullPage: true,
  });
  checked("Other Income dialog fits a 390px mobile viewport");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await dialog.getByRole("button", { name: "Cancel" }).click();

  assert.deepEqual(pageErrors, []);
  assert.equal(
    calls.some((call) =>
      ["finance_post_smart_drive", "finance_refresh_payments"].includes(call.name),
    ),
    false,
    "Customization checks must not edit extracted E-hailing or Smart Drive sources",
  );
  checked("No extracted E-hailing or Smart Drive mutation was attempted");

  const evidence = {
    passed: true,
    fixture: "All Supabase requests intercepted; in-memory privacy-safe data only",
    backendCorrectnessClaimed: false,
    checks,
    screenshots: [
      "fixed-operating-costs-desktop.png",
      "workshop-summary-desktop.png",
      "other-income-mobile.png",
    ],
    financeRpcCalls: calls.map((call) => call.name),
    pageErrors,
  };
  await writeFile(
    new URL("evidence.json", output),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(`PASS: ${checks.join("; ")}`);
} catch (error) {
  await page.screenshot({
    path: fileURLToPath(new URL("failure.png", output)),
    fullPage: true,
  });
  await writeFile(
    new URL("evidence.json", output),
    `${JSON.stringify(
      {
        passed: false,
        fixture: "All Supabase requests intercepted; in-memory privacy-safe data only",
        backendCorrectnessClaimed: false,
        checks,
        error: error.message,
        pageErrors,
        financeRpcCalls: calls.map((call) => call.name),
      },
      null,
      2,
    )}\n`,
  );
  console.error("Finance customization UI verification failed:", error);
  console.error(
    (await page.locator("main").innerText().catch(() => page.locator("body").innerText())).slice(-6000),
  );
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
