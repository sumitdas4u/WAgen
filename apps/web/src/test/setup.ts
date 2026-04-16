import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

afterEach(cleanup);

const originalWarn = console.warn;

beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation((message: unknown, ...args: unknown[]) => {
    if (typeof message === "string" && message.includes("React Router Future Flag Warning")) {
      return;
    }
    originalWarn(message, ...args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
