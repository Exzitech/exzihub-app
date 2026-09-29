import type { ToolConfig } from "./registry";

/**
 * Outils qui etaient livres avec le hub et sont devenus des plugins.
 *
 * Apres une mise a jour, un tel outil disparait de la barre laterale tant que
 * l'utilisateur ne l'a pas installe depuis l'ecran Outils - et rien ne le lui
 * dit. On le repere a ses donnees, restees dans le stockage du hub : plugin et
 * hub partagent la meme origine, donc le meme localStorage, et une cle
 * presente signifie que l'outil a reellement servi sur ce PC.
 *
 * Reperer les donnees plutot que l'ancien dossier `tools/<outil>/` : c'est ce
 * que l'utilisateur tient a retrouver, et l'installeur efface le dossier.
 */
export interface Migration {
  id: string;
  name: string;
  /**
   * Cles de stockage que l'outil ecrit en service normal ; une seule suffit.
   * Plusieurs, parce qu'un outil ne laisse pas la meme trace selon ce qu'on en
   * fait : Coût des plats ecrit son historique de prix des qu'il lit un achat,
   * mais quelqu'un qui n'a fait que consulter le catalogue n'a que ses filtres.
   */
  markers: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
];

const CLE_IGNOREES = "migration:ignorees";

function ignorees(): string[] {
  try {
    const brut = localStorage.getItem(CLE_IGNOREES);
    return brut ? (JSON.parse(brut) as string[]) : [];
  } catch {
    return [];
  }
}

/** "Plus tard" : ne plus proposer cet outil, sans rien installer. */
export function ignorerMigration(id: string): void {
  try {
    localStorage.setItem(CLE_IGNOREES, JSON.stringify([...new Set([...ignorees(), id])]));
  } catch { /* confort */ }
}

function aDesDonnees(markers: readonly string[]): boolean {
  try {
    return markers.some((cle) => localStorage.getItem(cle) !== null);
  } catch {
    return false; // navigation privee, stockage bloque : on ne propose rien.
  }
}

/**
 * Outils a reproposer : deja utilises ici, absents de la liste actuelle, et
 * presents dans le catalogue (sinon le bouton d'installation n'aboutirait pas).
 */
export function migrationsEnAttente(
  tools: ToolConfig[],
  catalogIds: readonly string[],
): Migration[] {
  const ignore = new Set(ignorees());
  return MIGRATIONS.filter((m) =>
    !ignore.has(m.id)
    && !tools.some((t) => t.id === m.id)
    && catalogIds.includes(m.id)
    && aDesDonnees(m.markers));
}
