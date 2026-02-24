import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authUser: {
      userId: string;
      email: string;
    };
  }
}