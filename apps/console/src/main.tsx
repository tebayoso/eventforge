import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import LandingPage from "./LandingPage";
import "./styles.css";

const isConsoleRoute = window.location.pathname === "/console" || window.location.pathname.startsWith("/console/");

createRoot(document.getElementById("root")!).render(<StrictMode>{isConsoleRoute ? <App /> : <LandingPage />}</StrictMode>);
