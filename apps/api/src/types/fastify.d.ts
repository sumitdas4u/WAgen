import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authUser: {
      userId: string;
      email: string;
    };
    adminUser?: {
      email: string;
      role: "super_admin";
    };
    rawBody?: string | Buffer;
  }
}
