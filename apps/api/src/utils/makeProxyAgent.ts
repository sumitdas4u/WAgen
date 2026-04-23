import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export interface ProxyConfig {
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export function buildProxyUrl(config: ProxyConfig): string {
  const auth =
    config.username && config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : config.username
        ? `${encodeURIComponent(config.username)}@`
        : "";

  return `${config.protocol}://${auth}${config.host}:${config.port}`;
}

export function makeProxyAgent(config: ProxyConfig): HttpsProxyAgent<string> | SocksProxyAgent {
  const url = buildProxyUrl(config);
  if (config.protocol === "socks5") {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}

export function makeProxyAgentUndici(config: ProxyConfig): { uri: string } {
  return { uri: buildProxyUrl(config) };
}
