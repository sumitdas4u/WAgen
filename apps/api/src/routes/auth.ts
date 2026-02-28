import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticateUser,
  createUser,
  createUserFromFirebase,
  getUserAuthIdentityByEmail,
  getUserByFirebaseUid,
  getUserById,
  setUserFirebaseUid,
  setUserFirebaseUidAndDisableLegacyPassword,
  userEmailExists
} from "../services/user-service.js";
import {
  createFirebaseEmailUser,
  getFirebaseUserByEmail,
  updateFirebaseEmailUser,
  verifyFirebaseIdToken
} from "../services/firebase-admin.js";

const SignupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  businessType: z.string().min(2).optional()
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const FirebaseSessionSchema = z.object({
  idToken: z.string().min(1),
  name: z.string().min(2).optional(),
  businessType: z.string().min(2).optional()
});

const LegacyMigrateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const issueToken = (userId: string, email: string) =>
    fastify.jwt.sign({ userId, email }, { expiresIn: "7d" });

  fastify.post("/api/auth/signup", async (request, reply) => {
    const parsed = SignupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid signup payload" });
    }

    const exists = await userEmailExists(parsed.data.email);
    if (exists) {
      return reply.status(409).send({ error: "Email already in use. Please log in." });
    }

    try {
      const user = await createUser(parsed.data);
      const token = issueToken(user.id, user.email);
      return reply.send({ token, user });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return reply.status(409).send({ error: "Email already in use. Please log in." });
      }
      throw error;
    }
  });

  fastify.post("/api/auth/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid login payload" });
    }

    const user = await authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const token = issueToken(user.id, user.email);
    return reply.send({ token, user });
  });

  fastify.post("/api/auth/firebase/session", async (request, reply) => {
    const parsed = FirebaseSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid Firebase auth payload" });
    }

    try {
      const decodedToken = await verifyFirebaseIdToken(parsed.data.idToken);
      const email = decodedToken.email?.trim().toLowerCase();

      if (!email) {
        return reply.status(400).send({ error: "Firebase token is missing an email address" });
      }

      if (!decodedToken.email_verified) {
        return reply.status(403).send({ error: "Email not verified. Please verify your email before login." });
      }

      let user = await getUserByFirebaseUid(decodedToken.uid);
      if (!user) {
        const existingByEmail = await getUserAuthIdentityByEmail(email);

        if (existingByEmail) {
          if (existingByEmail.firebase_uid && existingByEmail.firebase_uid !== decodedToken.uid) {
            return reply
              .status(409)
              .send({ error: "This email is linked to another Firebase account. Contact support." });
          }

          await setUserFirebaseUid(existingByEmail.id, decodedToken.uid);
          user = await getUserById(existingByEmail.id);
        } else {
          const fallbackName =
            parsed.data.name?.trim() ||
            (typeof decodedToken.name === "string" && decodedToken.name.trim().length >= 2
              ? decodedToken.name.trim()
              : email.split("@")[0]);

          user = await createUserFromFirebase({
            name: fallbackName,
            email,
            firebaseUid: decodedToken.uid,
            businessType: parsed.data.businessType
          });
        }
      }

      if (!user) {
        return reply.status(500).send({ error: "Unable to load user profile" });
      }

      const token = issueToken(user.id, user.email);
      return reply.send({ token, user });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        code === "auth/id-token-expired" ||
        code === "auth/id-token-revoked" ||
        code === "auth/invalid-id-token" ||
        code === "auth/argument-error"
      ) {
        return reply.status(401).send({ error: "Invalid or expired Firebase session. Please log in again." });
      }
      throw error;
    }
  });

  fastify.post("/api/auth/legacy/migrate", async (request, reply) => {
    const parsed = LegacyMigrateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid migration payload" });
    }

    const user = await authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const identity = await getUserAuthIdentityByEmail(parsed.data.email);
    if (!identity) {
      return reply.status(404).send({ error: "User not found" });
    }

    if (!identity.password_hash) {
      return reply.send({ ok: true, migrated: true });
    }

    try {
      const existingFirebaseUser = await getFirebaseUserByEmail(identity.email);
      const firebaseUser = existingFirebaseUser
        ? await updateFirebaseEmailUser(existingFirebaseUser.uid, {
            password: parsed.data.password,
            displayName: identity.name,
            emailVerified: true
          })
        : await createFirebaseEmailUser({
            email: identity.email,
            password: parsed.data.password,
            displayName: identity.name,
            emailVerified: true
          });

      await setUserFirebaseUidAndDisableLegacyPassword(identity.id, firebaseUser.uid);
      return reply.send({ ok: true, migrated: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return reply.status(409).send({ error: "Firebase account is already linked to another user" });
      }
      throw error;
    }
  });

  fastify.get("/api/auth/me", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const user = await getUserById(request.authUser.userId);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return reply.send({ user });
  });
}
