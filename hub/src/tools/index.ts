import type { ComponentType } from "react";
import type { ToolConfig } from "../registry";

export interface ToolScreenProps {
  tool: ToolConfig;
  /** Fenetre flottante : vue demandee ("" = vue par defaut de l'outil). */
  view?: string;
}

/**
 * Ecran des outils livres avec le hub, par `id` de tools.json.
 *
 * Vide : tous les outils sont des plugins (plugins-src/), installables et
 * actualisables sans retelecharger le hub. Un outil integre ne se justifierait
 * que s'il devait demarrer avant que les plugins soient charges.
 */
export const toolScreens: Record<string, ComponentType<ToolScreenProps>> = {};

/** Vue reduite optionnelle, affichee dans une fenetre flottante au-dessus du jeu. */
export const toolOverlays: Record<string, ComponentType<ToolScreenProps>> = {};
