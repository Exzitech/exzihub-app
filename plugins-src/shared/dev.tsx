/**
 * Harnais de developpement : fait tourner un plugin seul dans le navigateur,
 * avec HMR, sans compiler ni relancer le hub.
 *
 * Installe un faux window.ExziHub, puis charge le plugin et affiche son ecran.
 * Ce qui n'existe que sous Tauri (fenetres flottantes, enregistrer sous) est
 * remplace par des bouchons visibles en console : un plugin qui s'en sert
 * devra etre verifie dans le vrai hub avant publication.
 *
 * Usage, dans <id>/src/dev.tsx :
 *     import { demarrerDev } from "../../shared/dev";
 *     demarrerDev("mon-plugin", () => import("./index"));
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import type { PluginExports, ToolConfig, ToolScreenProps } from "./hub";

// Feuille du hub : variables de couleur et classes communes, que les styles
// des plugins presupposent (.btn-ghost, .overlay-*, .health-dot...).
import "../../hub/src/styles.css";

const ecrans: Record<string, ComponentType<ToolScreenProps>> = {};
const vuesFlottantes: Record<string, ComponentType<ToolScreenProps>> = {};

function telecharger(nom: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(url);
}

const bouchon = (nom: string) => (...args: unknown[]) => {
  console.info(`[dev] ${nom}() n'existe que dans le hub`, ...args);
};

// Installe AVANT le chargement du plugin : shared/hub.ts lit window.ExziHub
// des son import, donc le plugin ne doit etre importe qu'ensuite.
(window as unknown as { ExziHub: unknown }).ExziHub = {
  React,
  jsxRuntime,
  ReactDOM,
  PinButton: () => <button className="btn-ghost" title="Epingler (hub seulement)">📌</button>,
  openOverlay: bouchon("openOverlay"),
  overlayKey: (toolId: string, view = "") => (view ? `${toolId}::${view}` : toolId),
  canOpenOverlay: false,
  rememberOverlayGeometry: async () => () => {},
  useAutoHeight: () => {},
  closeWindow: bouchon("closeWindow"),
  // Telechargement du navigateur, comme exportFile plus bas.
  saveFileAs: async (nom: string, octets: Uint8Array) => {
    telecharger(nom, new Blob([new Uint8Array(octets)]));
    return nom;
  },
  // Synchro simulee dans localStorage (cle "sync:<id>/<nom>", version = compteur) :
  // meme contrat que le hub (ecriture refusee si la version lue n'est plus la bonne).
  sync: {
    etat: async () => ({ compte: "dev@localStorage", espace: { mode: "compte", dossier: "dev" } }),
    lire: async (id: string, nom: string) => {
      const brut = localStorage.getItem(`sync:${id}/${nom}`);
      return brut ? { ...JSON.parse(brut), horsLigne: false } : null;
    },
    ecrire: async (id: string, nom: string, texte: string, version: string | null) => {
      const cle = `sync:${id}/${nom}`;
      const brut = localStorage.getItem(cle);
      if ((brut ? JSON.parse(brut).version : null) !== version) return null;
      const suivante = String(Number(version ?? 0) + 1);
      localStorage.setItem(cle, JSON.stringify({ texte, version: suivante }));
      return suivante;
    },
    modifier: async (id: string, nom: string, f: (texte: string | null) => string) => {
      const cle = `sync:${id}/${nom}`;
      const brut = localStorage.getItem(cle);
      const { texte = null, version = "0" } = brut ? JSON.parse(brut) : {};
      const suivante = String(Number(version) + 1);
      localStorage.setItem(cle, JSON.stringify({ texte: f(texte), version: suivante }));
      return suivante;
    },
  },
  SyncSetup: () => <p className="muted">(synchro Nextcloud : hub seulement ; ici localStorage)</p>,
  useToolSocket: () => ({ status: "closed" as const, send: () => false }),
  LaunchButton: () => <span className="muted">(moteur : hub seulement)</span>,
  // Telechargement du navigateur : le plus proche de l'ecriture dans Telechargements.
  exportFile: async (nom: string, contenu: string) => {
    telecharger(nom, new Blob([contenu], { type: "application/json" }));
    return nom;
  },
  toast: (texte: string, type: "ok" | "erreur" = "ok") => console.log(`[${type}] ${texte}`),
  register(id: string, plugin: PluginExports) {
    ecrans[id] = plugin.Tool;
    if (plugin.Overlay) vuesFlottantes[id] = plugin.Overlay;
  },
};

/**
 * Charge le plugin et affiche son ecran dans #root.
 * `?vue=flottante` affiche la vue flottante a la place, si le plugin en a une.
 * `nom` : titre affiche par le plugin (dans le hub, celui du manifeste).
 */
export async function demarrerDev(id: string, charger: () => Promise<unknown>, nom = id): Promise<void> {
  await charger();

  const flottante = new URLSearchParams(location.search).get("vue") === "flottante";
  const Ecran = flottante ? vuesFlottantes[id] : ecrans[id];
  const racine = document.getElementById("root");
  if (!racine) throw new Error("#root introuvable dans index.html");

  if (!Ecran) {
    racine.textContent = flottante
      ? `Le plugin ${id} n'a pas de vue flottante.`
      : `Le plugin ${id} ne s'est pas enregistre (register("${id}", ...) manquant ?).`;
    return;
  }

  const outil: ToolConfig = { id, name: nom, version: "dev" };
  document.documentElement.classList.toggle("is-overlay", flottante);
  createRoot(racine).render(
    <React.StrictMode>
      <div className={flottante ? "" : "content"}>
        <Ecran tool={outil} view="" />
      </div>
    </React.StrictMode>,
  );
}
