import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, vi } from "vitest";

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
