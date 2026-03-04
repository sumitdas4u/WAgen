import { API_URL } from "../lib/api";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

export function initWebVitalsReporting() {
  const endpoint = `${API_URL}/api/observability/vitals`;

  const send = (metric: Metric) => {
    const payload = {
      app: "web",
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined
    };

    const body = JSON.stringify(payload);

    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return;
    }

    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  };

  onCLS(send);
  onFCP(send);
  onINP(send);
  onLCP(send);
  onTTFB(send);
}

