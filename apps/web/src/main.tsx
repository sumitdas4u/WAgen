import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./app/providers";
import { firebaseReady } from "./lib/firebase";
import { initWebVitalsReporting } from "./observability/web-vitals";
import "./styles.css";

initWebVitalsReporting();

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </React.StrictMode>
  );
}

firebaseReady.then(renderApp).catch((error: unknown) => {
  console.error(error);
  document.getElementById("root")!.textContent =
    error instanceof Error ? error.message : "Application configuration failed to load.";
});
