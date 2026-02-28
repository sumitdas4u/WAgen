import { readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken, type UserRecord } from "firebase-admin/auth";
import { env } from "../config/env.js";

interface ServiceAccountFile {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

function isConfiguredWithServiceAccount(): boolean {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}

function loadServiceAccountFromFile():
  | { projectId: string; clientEmail: string; privateKey: string }
  | null {
  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return null;
  }

  const raw = readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8");
  const parsed = JSON.parse(raw) as ServiceAccountFile;

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("Invalid Firebase service account JSON file.");
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key
  };
}

function initializeFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountFromFile = loadServiceAccountFromFile();
  if (serviceAccountFromFile) {
    return initializeApp({
      projectId: serviceAccountFromFile.projectId,
      credential: cert({
        projectId: serviceAccountFromFile.projectId,
        clientEmail: serviceAccountFromFile.clientEmail,
        privateKey: serviceAccountFromFile.privateKey
      })
    });
  }

  if (isConfiguredWithServiceAccount()) {
    return initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
      })
    });
  }

  if (!env.FIREBASE_PROJECT_ID) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID + service account credentials."
    );
  }

  return initializeApp({
    projectId: env.FIREBASE_PROJECT_ID,
    credential: applicationDefault()
  });
}

function firebaseAuth() {
  return getAuth(initializeFirebaseAdmin());
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  return firebaseAuth().verifyIdToken(idToken);
}

export async function getFirebaseUserByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await firebaseAuth().getUserByEmail(email.trim().toLowerCase());
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") {
      return null;
    }
    throw error;
  }
}

export async function createFirebaseEmailUser(input: {
  email: string;
  password: string;
  displayName?: string;
  emailVerified?: boolean;
}): Promise<UserRecord> {
  return firebaseAuth().createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    displayName: input.displayName?.trim() || undefined,
    emailVerified: input.emailVerified
  });
}

export async function updateFirebaseEmailUser(
  uid: string,
  input: {
    password?: string;
    displayName?: string;
    emailVerified?: boolean;
  }
): Promise<UserRecord> {
  return firebaseAuth().updateUser(uid, {
    password: input.password,
    displayName: input.displayName?.trim() || undefined,
    emailVerified: input.emailVerified
  });
}
