import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import type { PersonalityOption, User } from "../types/models.js";

interface UserRow extends User {
  password_hash: string | null;
  firebase_uid: string | null;
}

export interface UserAuthIdentity {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  firebase_uid: string | null;
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
    ai_active: row.ai_active
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
     RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active`,
    [input.name.trim(), normalizedEmail, passwordHash, input.businessType ?? null]
  );

  return result.rows[0];
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
     RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active`,
    [input.name.trim(), normalizedEmail, input.firebaseUid, input.businessType ?? null]
  );

  return result.rows[0];
}

export async function authenticateUser(email: string, password: string): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, firebase_uid, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active
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
    `SELECT id, name, email, password_hash, firebase_uid
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  return result.rows[0] ?? null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function getUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, firebase_uid, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active
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
    supportAddress: string;
    supportPhoneNumber: string;
    supportContactName: string;
    supportEmail: string;
    aiDoRules: string;
    aiDontRules: string;
    websiteUrl?: string;
    manualFaq?: string;
  }
): Promise<void> {
  await pool.query(
    `UPDATE users
     SET business_basics = $1::jsonb
     WHERE id = $2`,
    [JSON.stringify(basics), userId]
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
