import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import LandingPage from "./LandingPage";
import "./styles.css";
import { applyTheme, getInitialTheme } from "./theme";

const isConsoleRoute =
  Boolean(window.eventforgeDesktop) ||
  window.location.pathname === "/console" ||
  window.location.pathname.startsWith("/console/");
applyTheme(getInitialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isConsoleRoute ? <App /> : <LandingPage />}</StrictMode>,
);
