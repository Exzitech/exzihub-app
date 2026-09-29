import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import type { ComponentType } from "react";
import { LaunchButton } from "./components/LaunchButton";
import { PinButton } from "./components/PinButton";
import { SyncSetup } from "./components/SyncSetup";
import { useToolSocket } from "./hooks/useToolSocket";
import { canOpenOverlay, openOverlay, overlayKey, rememberOverlayGeometry, useAutoHeight } from "./overlay";
import type { ToolConfig } from "./registry";
import { isMobile } from "./platform";
import { sync } from "./sync";
import { toast } from "./toast";
import type { ToolScreenProps } from "./tools";

/**
 * Plugins : plugins/<id>/{manifest.json, index.js, style.css}, charges au demarrage.
 * index.js est un IIFE qui s'enregistre via window.ExziHub.register ; React est
 * fourni par le hub (une seule copie, sinon les hooks cassent).
 */
export interface PluginManifest extends ToolConfig {
  version?: string;
  /** Fichier JS du plugin (defaut : index.js). */
  entry?: string;
  /** Feuille de style optionnelle. */
  style?: string;
}

interface PluginExports {
  Tool: ComponentType<ToolScreenProps>;
  Overlay?: ComponentType<ToolScreenProps>;
}

export const pluginScreens: Record<string, ComponentType<ToolScreenProps>> = {};
export const pluginOverlays: Record<string, ComponentType<ToolScreenProps>> = {};

(window as unknown as { ExziHub: unknown }).ExziHub = {
  React,
  jsxRuntime,
  ReactDOM,
  // Briques du hub reutilisees par les plugins (typees dans plugins-src/shared/hub.ts).
  PinButton,
  openOverlay,
  overlayKey,
  canOpenOverlay,
  rememberOverlayGeometry,
  useAutoHeight,
  closeWindow: () => getCurrentWindow().close(),
  // Plugin a moteur : dialogue avec son backend et bouton lancer/arreter.
  useToolSocket,
  LaunchButton,
  /** Confirmation passagere en bas de l'ecran. */
  toast,
  /**
   * Ecrit un fichier texte dans Telechargements ; renvoie son chemin.
   * La confirmation est faite ici, une fois pour tous les plugins : sans elle,
   * rien ne distingue un export reussi d'un clic sans effet. Sur Android, le
   * menu de partage sert lui-meme de confirmation et le chemin rendu n'est
   * qu'une copie en cache : pas de message.
   */
  async exportFile(name: string, contents: string): Promise<string> {
    const chemin = await invoke<string>("export_file", { name, contents });
    if (!isMobile) toast(`Fichier enregistré : ${chemin}`);
    return chemin;
  },
  // Synchro Nextcloud (WebDAV) : connexion, espace du plugin, lecture/ecriture sans ecrasement.
  sync,
  SyncSetup,
  /** "Enregistrer sous" : renvoie le chemin choisi, ou null si annule (Tauri uniquement). */
  async saveFileAs(name: string, bytes: Uint8Array): Promise<string | null> {
    const chemin = await invoke<string | null>("save_binary_as", bytes, { headers: { "x-file-name": name } });
    if (chemin && !isMobile) toast(`Fichier enregistré : ${chemin}`);
    return chemin;
  },
  register(id: string, plugin: PluginExports) {
    pluginScreens[id] = plugin.Tool;
    if (plugin.Overlay) pluginOverlays[id] = plugin.Overlay;
  },
};

async function readFile(id: string, file: string): Promise<string> {
  return invoke<string>("read_plugin_file", { id, file });
}

function isManifest(value: unknown): value is PluginManifest {
  const m = value as PluginManifest;
  return !!m && typeof m.id === "string" && typeof m.name === "string";
}

/** Version chargee de chaque plugin : un rechargement saute ceux qui n'ont pas change. */
const loadedVersions = new Map<string, string>();

/** Retire un plugin charge : son script n'est pas annulable, mais son ecran et son style le sont. */
function unloadPlugin(id: string) {
  document.querySelectorAll(`[data-plugin="${id}"]`).forEach((el) => el.remove());
  delete pluginScreens[id];
  delete pluginOverlays[id];
  loadedVersions.delete(id);
}

/**
 * Charge les plugins installes ; un plugin defaillant n'empeche pas les autres.
 * Rappelable apres une installation, une mise a jour ou une desinstallation.
 */
export async function loadPlugins(): Promise<PluginManifest[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  let manifests: unknown[];
  try {
    manifests = JSON.parse(await invoke<string>("list_plugins"));
  } catch (err) {
    console.error("Liste des plugins illisible :", err);
    return [];
  }

  const installed = manifests.filter(isManifest);
  for (const id of [...loadedVersions.keys()]) {
    if (!installed.some((m) => m.id === id)) unloadPlugin(id);
  }

  const loaded: PluginManifest[] = [];
  for (const manifest of installed) {
    const version = String(manifest.version ?? "");
    if (loadedVersions.get(manifest.id) === version && pluginScreens[manifest.id]) {
      loaded.push(manifest);
      continue;
    }
    unloadPlugin(manifest.id);
    try {
      if (manifest.style) {
        const style = document.createElement("style");
        style.dataset.plugin = manifest.id;
        style.textContent = await readFile(manifest.id, manifest.style);
        document.head.appendChild(style);
      }
      const script = document.createElement("script");
      script.dataset.plugin = manifest.id;
      script.textContent = await readFile(manifest.id, manifest.entry ?? "index.js");
      document.head.appendChild(script);
      if (pluginScreens[manifest.id]) {
        loadedVersions.set(manifest.id, version);
        loaded.push(manifest);
      } else {
        console.error(`Plugin ${manifest.id} : index.js ne s'est pas enregistre`);
      }
    } catch (err) {
      console.error(`Plugin ${manifest.id} non charge :`, err);
    }
  }
  return loaded;
}
