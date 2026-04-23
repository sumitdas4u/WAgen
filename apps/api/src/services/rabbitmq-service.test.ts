import { describe, expect, it } from "vitest";

describe("RabbitMQ routing key", () => {
  it("uses event name as routing key", () => {
    const routingKey = (event: string) => event;
    expect(routingKey("messages.upsert")).toBe("messages.upsert");
    expect(routingKey("connection.update")).toBe("connection.update");
  });
});
