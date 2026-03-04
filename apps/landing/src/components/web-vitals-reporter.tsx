"use client";

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { useEffect } from "react";

export function WebVitalsReporter() {
  useEffect(() => {
    const baseUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");

    if (!baseUrl) return;

    const endpoint = `${baseUrl}/api/observability/vitals`;

    const send = (metric: Metric) => {
      const payload = {
        app: "landing",
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        navigationType: metric.navigationType,
        url: window.location.href,
        userAgent: navigator.userAgent
      };

      const body = JSON.stringify(payload);

      if ("sendBeacon" in navigator) {
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
  }, []);

  return null;
}

