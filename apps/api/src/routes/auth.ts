import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authenticateUser,
  createUser,
  createUserFromGoogleAuth,
  createPasswordResetToken,
  getUserAuthIdentityByEmail,
  getUserByGoogleAuthSub,
  getUserById,
  setUserGoogleAuthSub,
  resetUserPasswordWithToken,
  updateUserPassword,
  updateUserDetails,
  userEmailExists
} from "../services/user-service.js";
import {
  buildGoogleAuthConnectUrl,
  completeGoogleAuthCallback,
  renderGoogleAuthPopupPage
} from "../services/google-auth-service.js";
import { deleteAccountWithAssociatedData } from "../services/account-deletion-service.js";
import { sendTransactionalEmail } from "../services/email-service.js";
import {
  creditSignupTokens,
  getTokenStatus,
  getTokenLedger,
  getTokenUsageByAction,
  getTokenUsageByDay
} from "../services/ai-token-service.js";
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

const UpdateMeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  businessType: z.string().max(100).optional(),
  companyName: z.string().max(200).optional(),
  websiteUrl: z.string().max(500).optional(),
  supportEmail: z.string().max(200).optional(),
  phoneNumber: z.string().max(30).optional(),
  phoneVerified: z.boolean().optional()
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8)
});

const ForgotPasswordSchema = z.object({
  email: z.string().email()
});

const ResetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8)
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
  const getAppBaseUrl = (request: FastifyRequest) => {
    const origin = getRequestOrigin(request);
    return origin ?? env.APP_BASE_URL.replace(/\/$/, "");
  };

  fastify.post("/api/auth/signup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
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
      void creditSignupTokens(user.id);
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

  fastify.post("/api/auth/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
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

  fastify.get("/api/auth/google/callback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
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
          if (user) void creditSignupTokens(user.id);
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

  fastify.post(
    "/api/auth/password/change",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = ChangePasswordSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid password change payload" });
      }

      const result = await updateUserPassword({
        userId: request.authUser.userId,
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword
      });

      if (result === "not_found") {
        return reply.status(404).send({ error: "User not found" });
      }
      if (result === "missing_password") {
        return reply.status(409).send({ error: "Password login is not enabled for this account." });
      }
      if (result === "invalid_current_password") {
        return reply.status(401).send({ error: "Current password is incorrect." });
      }

      return reply.send({ ok: true });
    }
  );

  fastify.post("/api/auth/password/forgot", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const parsed = ForgotPasswordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return { ok: true };
    }

    const reset = await createPasswordResetToken(parsed.data.email);
    if (reset) {
      const resetUrl = `${getAppBaseUrl(request).replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(reset.token)}`;
      await sendTransactionalEmail({
        to: reset.email,
        subject: "Reset your WAgen AI password",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
            <h1 style="font-size:22px;margin:0 0 12px">Reset your password</h1>
            <p style="font-size:14px;line-height:1.6;color:#475569">Hi ${reset.name}, use the button below to set a new password. This link expires in 1 hour.</p>
            <p style="margin:24px 0">
              <a href="${resetUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:700">Reset password</a>
            </p>
            <p style="font-size:12px;line-height:1.6;color:#64748b">If you did not request this, you can safely ignore this email.</p>
          </div>
        `
      });
    }

    return { ok: true };
  });

  fastify.post("/api/auth/password/reset", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = ResetPasswordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid password reset payload" });
    }

    const result = await resetUserPasswordWithToken({
      token: parsed.data.token,
      newPassword: parsed.data.password
    });

    if (result === "invalid_or_expired") {
      return reply.status(400).send({ error: "Password reset link is invalid or expired." });
    }

    return { ok: true };
  });

  fastify.get("/api/auth/ai-wallet", { preHandler: [fastify.requireAuth] }, async (request) => {
    const userId = request.authUser.userId;
    const user = await getUserById(userId);
    const planCode = user?.subscription_plan ?? "trial";

    const [status, ledger, usageByAction, usageByDay] = await Promise.all([
      getTokenStatus(userId, planCode),
      getTokenLedger(userId, 50),
      getTokenUsageByAction(userId, 30),
      getTokenUsageByDay(userId, 30)
    ]);

    return { status, ledger, usageByAction, usageByDay };
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
