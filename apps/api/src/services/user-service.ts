import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import type { PersonalityOption, User } from "../types/models.js";
import { ensureWorkspaceForUser } from "./workspace-billing-service.js";

interface UserRow extends User {
  password_hash: string | null;
  firebase_uid: string | null;
  google_auth_sub: string | null;
}

export interface UserAuthIdentity {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  firebase_uid: string | null;
  google_auth_sub: string | null;
}

function toPublicUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    business_type: row.business_type,
    subscription_plan: row.subscription_plan,
    business_basics: row.business_basics,
    personality: row.personality,
    custom_personality_prompt: row.custom_personality_prompt,
    ai_active: row.ai_active,
    phone_number: row.phone_number ?? null,
    phone_verified: row.phone_verified ?? false,
    ai_token_balance: row.ai_token_balance ?? 0
  };
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  businessType?: string;
}): Promise<User> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 10);

  const result = await pool.query<User>(
    `INSERT INTO users (name, email, password_hash, business_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance`,
    [input.name.trim(), normalizedEmail, passwordHash, input.businessType ?? null]
  );

  const user = result.rows[0];
  if (user) {
    await ensureWorkspaceForUser(user.id);
  }
  return user;
}

export async function createUserFromFirebase(input: {
  name: string;
  email: string;
  firebaseUid: string;
  businessType?: string;
}): Promise<User> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const result = await pool.query<User>(
    `INSERT INTO users (name, email, password_hash, firebase_uid, business_type)
     VALUES ($1, $2, NULL, $3, $4)
     RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance`,
    [input.name.trim(), normalizedEmail, input.firebaseUid, input.businessType ?? null]
  );

  const user = result.rows[0];
  if (user) {
    await ensureWorkspaceForUser(user.id);
  }
  return user;
}

export async function createUserFromGoogleAuth(input: {
  name: string;
  email: string;
  googleAuthSub: string;
  businessType?: string;
}): Promise<User> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const result = await pool.query<User>(
    `INSERT INTO users (name, email, password_hash, google_auth_sub, business_type)
     VALUES ($1, $2, NULL, $3, $4)
     RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance`,
    [input.name.trim(), normalizedEmail, input.googleAuthSub, input.businessType ?? null]
  );

  const user = result.rows[0];
  if (user) {
    await ensureWorkspaceForUser(user.id);
  }
  return user;
}

export async function authenticateUser(email: string, password: string): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, firebase_uid, google_auth_sub, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row.password_hash) {
    return null;
  }
  const isValid = await bcrypt.compare(password, row.password_hash);
  if (!isValid) {
    return null;
  }

  return toPublicUser(row);
}

export async function userEmailExists(email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getUserAuthIdentityByEmail(email: string): Promise<UserAuthIdentity | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query<UserAuthIdentity>(
    `SELECT id, name, email, password_hash, firebase_uid, google_auth_sub
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  return result.rows[0] ?? null;
}

export async function getUserAuthIdentityById(userId: string): Promise<UserAuthIdentity | null> {
  const result = await pool.query<UserAuthIdentity>(
    `SELECT id, name, email, password_hash, firebase_uid, google_auth_sub
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function getUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, firebase_uid, google_auth_sub, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance
     FROM users
     WHERE firebase_uid = $1
     LIMIT 1`,
    [firebaseUid]
  );

  const row = result.rows[0];
  return row ? toPublicUser(row) : null;
}

export async function setUserFirebaseUid(userId: string, firebaseUid: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET firebase_uid = $1
     WHERE id = $2`,
    [firebaseUid, userId]
  );
}

export async function setUserFirebaseUidAndDisableLegacyPassword(userId: string, firebaseUid: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET firebase_uid = $1,
         password_hash = NULL
     WHERE id = $2`,
    [firebaseUid, userId]
  );
}

export async function getUserByGoogleAuthSub(googleAuthSub: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, firebase_uid, google_auth_sub, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance
     FROM users
     WHERE google_auth_sub = $1
     LIMIT 1`,
    [googleAuthSub]
  );

  const row = result.rows[0];
  return row ? toPublicUser(row) : null;
}

export async function setUserGoogleAuthSub(userId: string, googleAuthSub: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET google_auth_sub = $1
     WHERE id = $2`,
    [googleAuthSub, userId]
  );
}

export async function updateBusinessBasics(
  userId: string,
  basics: {
    companyName: string;
    whatDoYouSell: string;
    targetAudience: string;
    usp: string;
    objections: string;
    defaultCountry: string;
    defaultCurrency: string;
    greetingScript: string;
    availabilityScript: string;
    objectionHandlingScript: string;
    bookingScript: string;
    feedbackCollectionScript: string;
    complaintHandlingScript: string;
    supportEmail: string;
    aiDoRules: string;
    aiDontRules: string;
    escalationWhenToEscalate: string;
    escalationContactPerson: string;
    escalationPhoneNumber: string;
    escalationEmail: string;
    websiteUrl?: string;
    manualFaq?: string;
  }
): Promise<void> {
  const current = await getUserById(userId);
  const existingBasics =
    (current?.business_basics as Record<string, unknown> | null | undefined) ?? {};

  await pool.query(
    `UPDATE users
     SET business_basics = $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({ ...existingBasics, ...basics }), userId]
  );
}

export async function updatePersonality(
  userId: string,
  personality: PersonalityOption,
  customPrompt?: string
): Promise<void> {
  await pool.query(
    `UPDATE users
     SET personality = $1,
         custom_personality_prompt = $2
     WHERE id = $3`,
    [personality, customPrompt?.trim() || null, userId]
  );
}

export async function setAgentActive(userId: string, active: boolean): Promise<void> {
  await pool.query(
    `UPDATE users
     SET ai_active = $1
     WHERE id = $2`,
    [active, userId]
  );
}

export async function updateUserDetails(
  userId: string,
  data: {
    name?: string;
    businessType?: string;
    companyName?: string;
    websiteUrl?: string;
    supportEmail?: string;
    phoneNumber?: string;
    phoneVerified?: boolean;
  }
): Promise<User | null> {
  const current = await getUserById(userId);
  if (!current) return null;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    setClauses.push(`name = $${idx++}`);
    values.push(data.name.trim());
  }
  if (data.businessType !== undefined) {
    setClauses.push(`business_type = $${idx++}`);
    values.push(data.businessType.trim() || null);
  }

  const needsBasicsUpdate =
    data.companyName !== undefined ||
    data.websiteUrl !== undefined ||
    data.supportEmail !== undefined;

  if (data.phoneNumber !== undefined) {
    setClauses.push(`phone_number = $${idx++}`);
    values.push(data.phoneNumber.trim() || null);
  }
  if (data.phoneVerified !== undefined) {
    setClauses.push(`phone_verified = $${idx++}`);
    values.push(data.phoneVerified);
  }

  if (needsBasicsUpdate) {
    const existingBasics = (current.business_basics as Record<string, unknown>) ?? {};
    const merged = {
      ...existingBasics,
      ...(data.companyName !== undefined ? { companyName: data.companyName.trim() } : {}),
      ...(data.websiteUrl !== undefined ? { websiteUrl: data.websiteUrl.trim() } : {}),
      ...(data.supportEmail !== undefined ? { supportEmail: data.supportEmail.trim() } : {})
    };
    setClauses.push(`business_basics = $${idx++}::jsonb`);
    values.push(JSON.stringify(merged));
  }

  if (setClauses.length === 0) return current;

  values.push(userId);
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET ${setClauses.join(", ")}
     WHERE id = $${idx}
     RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance`,
    values
  );

  const row = result.rows[0];
  return row ? toPublicUser(row) : null;
}

export async function deleteUserById(userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM users
     WHERE id = $1`,
    [userId]
  );

  return (result.rowCount ?? 0) > 0;
}
