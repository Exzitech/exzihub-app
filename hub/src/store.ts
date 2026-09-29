import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { ToolConfig } from "./registry";
import { isMobile } from "./platform";

/** Une entree de index.json, publie dans le dossier partage (voir plugins-src/publier.cjs). */
export interface CatalogEntry {
  id: string;
  name: string;
  icon?: string;
  category?: string;
  subcategory?: string;
  version: string;
  description?: string;
  /** Taille du zip en octets. */
  size?: number;
}

/** Entree "hub" de index.json : executable du hub publie par hub/scripts/publier-hub.cjs. */
export interface HubRelease {
  version: string;
  size?: number;
}

export interface Catalog {
  plugins: CatalogEntry[];
  hub: HubRelease | null;
}

export const canUseStore = "__TAURI_INTERNALS__" in window && !isMobile;

export async function fetchCatalog(): Promise<Catalog> {
  const raw = JSON.parse(await invoke<string>("fetch_catalog"));
  const list: unknown = raw?.plugins;
  if (!Array.isArray(list)) throw new Error("Catalogue invalide (pas de liste \"plugins\")");
  return {
    plugins: list.filter((p): p is CatalogEntry => typeof p?.id === "string" && typeof p?.version === "string"),
    hub: typeof raw?.hub?.version === "string" ? raw.hub : null,
  };
}

/** Version du hub en cours d'execution (tauri.conf.json). */
export const hubVersion = () => getVersion();

/** Telecharge l'executable publie, remplace celui-ci et relance le hub (catalogue.rs). */
export const updateHub = () => invoke<void>("update_hub");

/** Version du hub a proposer, ou null si le catalogue n'a rien de plus recent. */
export function hubUpdate(catalog: Catalog | null, current: string | null): HubRelease | null {
  if (!catalog?.hub || !current) return null;
  return compareVersions(catalog.hub.version, current) > 0 ? catalog.hub : null;
}

export const installPlugin = (id: string) => invoke<void>("install_plugin", { id });
export const uninstallPlugin = (id: string) => invoke<void>("uninstall_plugin", { id });

/** Compare deux versions "1.2.3" ; >0 si a est plus recente que b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type PluginStatus = "absent" | "installed" | "update";

export function pluginStatus(entry: CatalogEntry, installed: ToolConfig[]): PluginStatus {
  const local = installed.find((t) => t.plugin && t.id === entry.id);
  if (!local) return "absent";
  return compareVersions(entry.version, local.version ?? "0") > 0 ? "update" : "installed";
}

export function countUpdates(catalog: CatalogEntry[], installed: ToolConfig[]): number {
  return catalog.filter((e) => pluginStatus(e, installed) === "update").length;
}

export function formatSize(bytes?: number): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
