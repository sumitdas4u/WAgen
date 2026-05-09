import { pool } from "../db/pool.js";

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "throwaway.email",
  "yopmail.com", "sharklasers.com", "guerrillamail.info", "guerrillamail.biz",
  "guerrillamail.de", "guerrillamail.net", "guerrillamail.org", "spam4.me",
  "trashmail.com", "trashmail.me", "trashmail.net", "maildrop.cc",
  "dispostable.com", "tempmail.com", "emailondeck.com", "fakeinbox.com",
  "spamgourmet.com", "discard.email", "mailnull.com", "getnada.com",
  "tempinbox.com", "throwam.com", "getairmail.com", "tempr.email",
  "crazymailing.com", "dispostable.com",
]);

async function insertFraudSignal(
  userId: string,
  signalType: string,
  severity: "low" | "medium" | "high",
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO fraud_signals (user_id, signal_type, severity, detail_json)
       VALUES ($1, $2, $3, $4)`,
      [userId, signalType, severity, JSON.stringify(detail)]
    );
  } catch {
    // Non-fatal — fraud detection must never break signup
  }
}

export async function checkSignupFraud(
  userId: string,
  email: string,
  ipAddress?: string
): Promise<void> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return;

  const checks: Promise<void>[] = [];

  // Disposable email domain
  if (DISPOSABLE_DOMAINS.has(domain)) {
    checks.push(insertFraudSignal(userId, "fake_email_domain", "medium", { domain, email }));
  }

  // Same email domain — repeated free trial (>1 other user with same domain in last 30d)
  checks.push(
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users
       WHERE email ILIKE $1 AND id != $2 AND created_at > NOW() - INTERVAL '30 days'`,
      [`%@${domain}`, userId]
    ).then((r) => {
      if (Number(r.rows[0]?.count ?? 0) >= 1) {
        return insertFraudSignal(userId, "repeated_trial", "low", { domain });
      }
    })
  );

  // Same IP — more than 2 existing accounts
  if (ipAddress) {
    checks.push(
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE signup_ip = $1 AND id != $2`,
        [ipAddress, userId]
      ).then((r) => {
        const count = Number(r.rows[0]?.count ?? 0);
        if (count >= 2) {
          return insertFraudSignal(userId, "same_ip_multiple_accounts", "high", {
            ip: ipAddress,
            existingCount: count,
          });
        }
      })
    );
  }

  await Promise.allSettled(checks);
}
