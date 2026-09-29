import { invoke } from "@tauri-apps/api/core";
import bundledTools from "../tools.json";
import { loadPlugins } from "./plugins";

export interface ToolConfig {
  id: string;
  name: string;
  /** Port du backend local ; absent pour un outil sans moteur (ecran seul). */
  port?: number;
  /** Nom d'icone (voir icons.tsx) ou emoji. */
  icon?: string;
  /** "games" ou "office" (voir categories.ts). */
  category?: string;
  /** Sous-groupe libre dans la categorie (ex. "Jeux") ; absent = directement dans la categorie. */
  subcategory?: string;
  /** Vrai pour un plugin installe depuis le catalogue (desinstallable). */
  plugin?: boolean;
  /** Version du plugin, lue dans son manifest. */
  version?: string;
  /** Ouvre la fenetre flottante de l'outil au lancement du hub. */
  autoOverlay?: boolean;
  /** Commande de lancement du backend ; lue et executee cote Rust uniquement. */
  launch?: { command: string; args?: string[]; cwd?: string };
}

function isToolConfig(value: unknown): value is ToolConfig {
  const t = value as ToolConfig;
  return !!t && typeof t.id === "string" && typeof t.name === "string"
    && (t.port === undefined || typeof t.port === "number");
}

/**
 * Lit tools.json au demarrage.
 *
 * Sous Tauri, le fichier est relu sur disque (commande Rust `load_tools`) : une
 * modification a la main est prise en compte au prochain lancement, sans
 * rebuild. Hors Tauri (navigateur en dev), on retombe sur la copie importee.
 *
 * Les plugins (plugins/<id>/manifest.json) s'ajoutent a la liste, sans rebuild.
 */
export async function loadTools(): Promise<ToolConfig[]> {
  let raw: unknown = bundledTools;
  if ("__TAURI_INTERNALS__" in window) {
    try {
      raw = JSON.parse(await invoke<string>("load_tools"));
    } catch (err) {
      console.error("tools.json illisible, copie embarquee utilisee :", err);
    }
  }
  const tools = Array.isArray(raw) ? raw.filter(isToolConfig) : [];
  // Plugins installes dans plugins/ ; un id deja declare dans tools.json garde la priorite.
  const plugins = await loadPlugins();
  return [...tools, ...plugins.filter((p) => !tools.some((t) => t.id === p.id)).map((p) => ({ ...p, plugin: true }))];
}
