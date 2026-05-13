import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DashboardIndexRoute } from "./dashboard-index-route";

vi.mock("./DashboardHomePage", () => ({
  DashboardHomePage: () => <div>Dashboard home route</div>
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}

function renderIndex(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/dashboard" element={<><DashboardIndexRoute /><LocationProbe /></>} />
        <Route path="/dashboard/inbox-v2" element={<><div>Inbox v2 route</div><LocationProbe /></>} />
        <Route path="/dashboard/settings/api" element={<><div>API settings route</div><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("DashboardIndexRoute", () => {
  it("renders dashboard home when no legacy tab query is present", () => {
    renderIndex("/dashboard");

    expect(screen.getByText("Dashboard home route")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
  });

  it("keeps legacy tab redirects for conversations", async () => {
    renderIndex("/dashboard?tab=conversations");

    expect(await screen.findByText("Inbox v2 route")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/dashboard/inbox-v2");
    });
  });

  it("keeps legacy settings submenu redirects", async () => {
    renderIndex("/dashboard?tab=settings&submenu=setup_api");

    expect(await screen.findByText("API settings route")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/dashboard/settings/api");
    });
  });
});
