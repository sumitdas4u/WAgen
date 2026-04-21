import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppProviders } from "./app/providers";
import { initWebVitalsReporting } from "./observability/web-vitals";
import "./styles.css";

initWebVitalsReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);
