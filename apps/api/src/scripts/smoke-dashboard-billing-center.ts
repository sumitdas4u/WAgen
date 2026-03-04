import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import { createUser } from "../services/user-service.js";
import {
  disableAutoRecharge,
  getAutoRechargeSettings,
  getWorkspaceBillingOverview,
  getWorkspaceBillingProfile,
  getWorkspaceTransactions,
  getWorkspaceUsageSeries,
  issueSubscriptionInvoiceFromPayment,
  listWorkspaceInvoices,
  markRechargeOrderPaidFromWebhook,
  upsertAutoRechargeSettings,
  upsertWorkspaceBillingProfile
} from "../services/workspace-billing-center-service.js";
import { getWorkspaceIdByUserId } from "../services/workspace-billing-service.js";

async function run(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const user = await createUser({
    name: `Billing Smoke ${suffix}`,
    email: `billing-smoke-${suffix}@example.com`,
    password: "StrongPass123!",
    businessType: "Billing Smoke Workspace"
  });

  try {
    const workspaceId = await getWorkspaceIdByUserId(user.id);
    assert.ok(workspaceId, "workspace id should exist");

    const overview = await getWorkspaceBillingOverview(user.id);
    assert.equal(overview.workspaceId, workspaceId, "overview workspace mismatch");

    const profileBefore = await getWorkspaceBillingProfile(user.id);
    assert.equal(profileBefore.workspaceId, workspaceId, "profile workspace mismatch");

    let invalidRejected = false;
    try {
      await upsertWorkspaceBillingProfile(user.id, { gstin: "INVALID_GSTIN" });
    } catch {
      invalidRejected = true;
    }
    assert.equal(invalidRejected, true, "invalid GSTIN should fail validation");

    const profile = await upsertWorkspaceBillingProfile(user.id, {
      legalName: "Billing Smoke Pvt Ltd",
      gstin: "27ABCDE1234F1Z5",
      addressLine1: "MG Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      billingEmail: user.email
    });
    assert.equal(profile.gstin, "27ABCDE1234F1Z5", "saved GSTIN mismatch");

    const fakeOrderId = `order_smoke_${suffix}`;
    await pool.query(
      `INSERT INTO credit_recharge_orders (
         workspace_id,
         user_id,
         razorpay_order_id,
         status,
         credits,
         amount_total_paise,
         amount_taxable_paise,
         gst_amount_paise,
         gst_rate_percent,
         currency,
         metadata_json
       )
       VALUES ($1, $2, $3, 'created', 1000, 49900, 42288, 7612, 18, 'INR', '{}'::jsonb)`,
      [workspaceId, user.id, fakeOrderId]
    );

    const paymentResult = await markRechargeOrderPaidFromWebhook({
      razorpayOrderId: fakeOrderId,
      razorpayPaymentId: `pay_smoke_${suffix}`,
      event: "payment.captured"
    });
    assert.equal(paymentResult.workspaceId, workspaceId, "recharge webhook workspace mismatch");

    await issueSubscriptionInvoiceFromPayment({
      userId: user.id,
      razorpayPaymentId: `pay_sub_${suffix}`,
      amountPaise: 99900,
      currency: "INR"
    });

    const invoices = await listWorkspaceInvoices(user.id, 10);
    assert.equal(invoices.length >= 2, true, "expected recharge + subscription invoices");

    const usage = await getWorkspaceUsageSeries(user.id, 6);
    assert.equal(usage.points.length, 6, "usage months length mismatch");

    const transactions = await getWorkspaceTransactions({ userId: user.id, limit: 20 });
    assert.equal(transactions.items.length > 0, true, "expected at least one billing transaction");

    const autoInitial = await getAutoRechargeSettings(user.id);
    assert.equal(autoInitial.workspaceId, workspaceId, "auto recharge workspace mismatch");

    const autoSaved = await upsertAutoRechargeSettings(user.id, {
      enabled: false,
      thresholdCredits: 100,
      rechargeCredits: 2000,
      maxRechargesPerDay: 2
    });
    assert.equal(autoSaved.rechargeCredits, 2000, "auto recharge credits mismatch");

    const autoDisabled = await disableAutoRecharge(user.id);
    assert.equal(autoDisabled.enabled, false, "auto recharge should be disabled");

    console.log("Dashboard billing center smoke test passed.");
  } finally {
    await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  }
}

run()
  .catch((error) => {
    console.error("Dashboard billing center smoke test failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
