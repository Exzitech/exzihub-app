import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Montserrat embarquee (paquet npm, pas de CDN) : l'app tourne hors ligne.
// Sous-ensemble latin seul : les subsets cyrillique et vietnamien tripleraient le poids.
import "@fontsource/montserrat/latin-400.css";
import "@fontsource/montserrat/latin-500.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
