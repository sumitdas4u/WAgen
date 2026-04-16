import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authenticateUser,
  createUser,
  createUserFromFirebase,
  createUserFromGoogleAuth,
  getUserAuthIdentityByEmail,
  getUserByGoogleAuthSub,
  getUserByFirebaseUid,
  getUserById,
  setUserFirebaseUid,
  setUserGoogleAuthSub,
  setUserFirebaseUidAndDisableLegacyPassword,
  updateUserDetails,
  userEmailExists
} from "../services/user-service.js";
import {
  createFirebaseEmailUser,
  getFirebaseUserByEmail,
  updateFirebaseEmailUser,
  verifyFirebaseIdToken
} from "../services/firebase-admin.js";
import {
  buildGoogleAuthConnectUrl,
  completeGoogleAuthCallback,
  renderGoogleAuthPopupPage
} from "../services/google-auth-service.js";
import { deleteAccountWithAssociatedData } from "../services/account-deletion-service.js";
import { env } from "../config/env.js";

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

const UpdateMeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  businessType: z.string().max(100).optional(),
  companyName: z.string().max(200).optional(),
  websiteUrl: z.string().max(500).optional(),
  supportEmail: z.string().max(200).optional(),
  phoneNumber: z.string().max(30).optional(),
  phoneVerified: z.boolean().optional()
});

const DeleteAccountSchema = z.object({
  confirmText: z.string().trim()
});

const GoogleAuthStartSchema = z.object({
  mode: z.enum(["login", "signup"]).optional(),
  businessType: z.string().trim().min(2).max(120).optional()
});

const GoogleAuthCallbackSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional()
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const issueToken = (userId: string, email: string) =>
    fastify.jwt.sign({ userId, email }, { expiresIn: "7d" });
  const getRequestOrigin = (request: FastifyRequest) => {
    const protoHeader = request.headers["x-forwarded-proto"];
    const hostHeader = request.headers["x-forwarded-host"] ?? request.headers.host;
    const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    if (typeof proto === "string" && proto.trim() && typeof host === "string" && host.trim()) {
      return `${proto.trim()}://${host.trim()}`;
    }
    try {
      return new URL(env.APP_BASE_URL).origin;
    } catch {
      return null;
    }
  };
  const getGoogleAuthRedirectUri = (request: FastifyRequest) => {
    const origin = getRequestOrigin(request);
    if (origin) {
      return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
    }
    return null;
  };

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

  fastify.get("/api/auth/google/start", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      }
    },
    handler: async (request, reply) => {
      const parsed = GoogleAuthStartSchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .type("text/html")
          .send(
            renderGoogleAuthPopupPage({
              status: "error",
              message: "Invalid Google auth start request."
            })
          );
      }

      try {
        const redirectUri = getGoogleAuthRedirectUri(request);
        if (!redirectUri) {
          throw new Error("Unable to determine the public Google login callback URL.");
        }
        const url = buildGoogleAuthConnectUrl({
          mode: parsed.data.mode,
          businessType: parsed.data.businessType,
          redirectUri
        });
        return reply.redirect(url);
      } catch (error) {
        return reply
          .status(500)
          .type("text/html")
          .send(
            renderGoogleAuthPopupPage({
              status: "error",
              message: (error as Error).message,
              appOrigin: getRequestOrigin(request)
            })
          );
      }
    }
  });

  fastify.get("/api/auth/google/callback", async (request, reply) => {
    const parsed = GoogleAuthCallbackSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .type("text/html")
        .send(
          renderGoogleAuthPopupPage({
            status: "error",
            message: "Invalid Google auth callback payload."
          })
        );
    }

    if (parsed.data.error) {
      return reply
        .type("text/html")
        .send(
          renderGoogleAuthPopupPage({
            status: "error",
            message: `Google login was cancelled or denied: ${parsed.data.error}`,
            appOrigin: getRequestOrigin(request)
          })
        );
    }

    if (!parsed.data.code || !parsed.data.state) {
      return reply
        .status(400)
        .type("text/html")
        .send(
          renderGoogleAuthPopupPage({
            status: "error",
            message: "Google login response is missing required parameters.",
            appOrigin: getRequestOrigin(request)
          })
        );
    }

    try {
      const redirectUri = getGoogleAuthRedirectUri(request);
      if (!redirectUri) {
        throw new Error("Unable to determine the public Google login callback URL.");
      }
      const googleProfile = await completeGoogleAuthCallback({
        code: parsed.data.code,
        state: parsed.data.state,
        redirectUri
      });

      if (!googleProfile.emailVerified) {
        return reply
          .status(403)
          .type("text/html")
          .send(
            renderGoogleAuthPopupPage({
              status: "error",
              message: "Google account email is not verified.",
              appOrigin: getRequestOrigin(request)
            })
          );
      }

      let user = await getUserByGoogleAuthSub(googleProfile.googleAccountId);
      if (!user) {
        const existingByEmail = await getUserAuthIdentityByEmail(googleProfile.email);

        if (existingByEmail) {
          if (
            existingByEmail.google_auth_sub &&
            existingByEmail.google_auth_sub !== googleProfile.googleAccountId
          ) {
            return reply
              .status(409)
              .type("text/html")
              .send(
                renderGoogleAuthPopupPage({
                  status: "error",
                  message: "This email is already linked to another Google account.",
                  appOrigin: getRequestOrigin(request)
                })
              );
          }

          await setUserGoogleAuthSub(existingByEmail.id, googleProfile.googleAccountId);
          user = await getUserById(existingByEmail.id);
        } else {
          user = await createUserFromGoogleAuth({
            name: googleProfile.name || googleProfile.email.split("@")[0],
            email: googleProfile.email,
            googleAuthSub: googleProfile.googleAccountId,
            businessType: googleProfile.businessType ?? undefined
          });
        }
      }

      if (!user) {
        throw new Error("Unable to load user profile.");
      }

      const token = issueToken(user.id, user.email);
      return reply
        .type("text/html")
        .send(
          renderGoogleAuthPopupPage({
            status: "success",
            message: "Google login complete.",
            token,
            user,
            appOrigin: getRequestOrigin(request)
          })
        );
    } catch (error) {
      return reply
        .status(500)
        .type("text/html")
        .send(
          renderGoogleAuthPopupPage({
            status: "error",
            message: (error as Error).message,
            appOrigin: getRequestOrigin(request)
          })
        );
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

  fastify.patch("/api/auth/me", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = UpdateMeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid update payload" });
    }

    const user = await updateUserDetails(request.authUser.userId, parsed.data);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return reply.send({ user });
  });

  fastify.post("/api/auth/account/delete", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = DeleteAccountSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid account deletion payload" });
    }

    if (parsed.data.confirmText !== "DELETE") {
      return reply.status(400).send({ error: "Type DELETE to confirm account removal." });
    }

    const deleted = await deleteAccountWithAssociatedData(request.authUser.userId);
    if (!deleted) {
      return reply.status(404).send({ error: "User not found" });
    }

    return reply.send({ ok: true });
  });
}
