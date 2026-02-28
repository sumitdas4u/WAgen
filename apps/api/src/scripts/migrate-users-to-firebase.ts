import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { createFirebaseEmailUser, getFirebaseUserByEmail } from "../services/firebase-admin.js";

interface LegacyUserRow {
  id: string;
  name: string;
  email: string;
}

function generateTemporaryPassword(): string {
  return `Tmp#${randomBytes(18).toString("base64url")}Aa1`;
}

async function migrateUsersToFirebase() {
  const dryRun = process.argv.includes("--dry-run");
  const usersResult = await pool.query<LegacyUserRow>(
    `SELECT id, name, email
     FROM users
     WHERE firebase_uid IS NULL
     ORDER BY created_at ASC`
  );

  let linked = 0;
  let created = 0;
  let failed = 0;

  console.log(`Users pending Firebase migration: ${usersResult.rowCount ?? 0}`);
  if (dryRun) {
    console.log("Running in dry-run mode. No DB or Firebase changes will be written.");
  }

  for (const user of usersResult.rows) {
    try {
      const existingFirebaseUser = await getFirebaseUserByEmail(user.email);
      if (dryRun) {
        if (existingFirebaseUser) {
          console.log(`[DRY RUN] Would link ${user.email} to existing Firebase uid ${existingFirebaseUser.uid}`);
        } else {
          console.log(`[DRY RUN] Would create Firebase user for ${user.email}`);
        }
        continue;
      }

      const firebaseUser =
        existingFirebaseUser ??
        (await createFirebaseEmailUser({
          email: user.email,
          displayName: user.name,
          password: generateTemporaryPassword(),
          emailVerified: true
        }));

      if (!existingFirebaseUser) {
        created += 1;
      }

      await pool.query(
        `UPDATE users
         SET firebase_uid = $1
         WHERE id = $2`,
        [firebaseUser.uid, user.id]
      );
      linked += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to migrate ${user.email}: ${message}`);
    }
  }

  console.log(`Migration complete. linked=${linked}, created=${created}, failed=${failed}, dryRun=${dryRun}`);
  console.log(
    "Users created with temporary passwords should use Forgot Password in production to set their own password."
  );
}

migrateUsersToFirebase()
  .catch((error) => {
    console.error("Firebase migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
