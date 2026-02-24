import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateUser, createUser, getUserById, userEmailExists } from "../services/user-service.js";

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

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
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
      const token = fastify.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: "7d" });
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

    const token = fastify.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: "7d" });
    return reply.send({ token, user });
  });

  fastify.get("/api/auth/me", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const user = await getUserById(request.authUser.userId);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return reply.send({ user });
  });
}
