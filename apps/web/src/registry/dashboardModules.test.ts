import { describe, expect, it, vi } from "vitest";
import { dashboardModules } from "./dashboardModules";

vi.mock("../lib/firebase", () => ({
  firebaseAuth: {}
}));

describe("dashboard module registry", () => {
  it("provides a prefetch hook for every code+data module", async () => {
    const loadedModules = await Promise.all(
      dashboardModules
        .filter((definition) => definition.prefetchStrategy === "code+data")
        .map(async (definition) => ({
          definition,
          routeModule: await definition.lazyRoute()
        }))
    );

    for (const { definition, routeModule } of loadedModules) {
      expect(definition.prefetchStrategy).toBe("code+data");
      expect(routeModule.prefetchData).toEqual(expect.any(Function));
    }
  }, 20000);
});
