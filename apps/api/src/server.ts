import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();

const close = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void close();
});

process.on("SIGTERM", () => {
  void close();
});

await app.listen({
  port: env.PORT,
  host: "0.0.0.0"
});