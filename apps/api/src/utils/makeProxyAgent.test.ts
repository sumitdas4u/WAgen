import { describe, expect, it } from "vitest";
import { buildProxyUrl } from "./makeProxyAgent.js";

describe("buildProxyUrl", () => {
  it("builds http proxy URL without auth", () => {
    const url = buildProxyUrl({ protocol: "http", host: "proxy.example.com", port: 8080 });
    expect(url).toBe("http://proxy.example.com:8080");
  });

  it("builds http proxy URL with auth", () => {
    const url = buildProxyUrl({
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "pass"
    });
    expect(url).toBe("http://user:pass@proxy.example.com:8080");
  });

  it("builds socks5 proxy URL", () => {
    const url = buildProxyUrl({ protocol: "socks5", host: "127.0.0.1", port: 1080 });
    expect(url).toBe("socks5://127.0.0.1:1080");
  });

  it("encodes special characters in password", () => {
    const url = buildProxyUrl({
      protocol: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
      password: "p@ss#word"
    });
    expect(url).toContain(encodeURIComponent("p@ss#word"));
  });
});
