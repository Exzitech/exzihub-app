import { useCallback, useEffect, useState } from "react";
import { useFichierSync } from "../../shared/fichierSync";

export const ID = "checklist";
export const FICHIER = "checklist.json";
export const DOSSIER = "ExziHub/Checklist";
/** Cle d'avant la synchro : sert de miroir et de reprise (voir fichierSync). */
const CLE = "checklist:taches";

export type Periode = "jour" | "semaine" | "manuel";

export interface Tache {
  id: string;
  nom: string;
  periode: Periode;
  /** Cle de la periode pendant laquelle la tache a ete cochee ("" = jamais). */
  faiteLe: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const jourDe = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Cle de la periode en cours : le jour, ou le lundi de la semaine (heure locale). */
export function clePeriode(periode: Periode, maintenant = new Date()): string {
  if (periode === "manuel") return "M";
  if (periode === "jour") return jourDe(maintenant);
  const lundi = new Date(maintenant);
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  return "S" + jourDe(lundi);
}

export const estFaite = (t: Tache, maintenant = new Date()) => t.faiteLe === clePeriode(t.periode, maintenant);

/** Tolere un fichier vide, corrompu ou d'une autre forme plutot que de casser l'ecran. */
function analyser(texte: string): Tache[] {
  try {
    const liste = JSON.parse(texte) as unknown;
    return Array.isArray(liste) ? (liste as Tache[]) : [];
  } catch {
    return [];
  }
}

/**
 * Taches sur Nextcloud (checklist.json) : le fichier est la source de verite,
 * relu avant chaque ecriture, donc cocher sur le telephone et sur le PC ne se
 * marche pas dessus. Une tache n'est jamais « reinitialisee » : elle n'est plus
 * cochee des que la periode change, meme hub ferme.
 */
export function useChecklist() {
  const f = useFichierSync<Tache[]>({
    id: ID, fichier: FICHIER, cleLocale: CLE, vide: () => [], analyser,
  });
  const [maintenant, setMaintenant] = useState(() => new Date());

  useEffect(() => {
    const minuteur = window.setInterval(() => setMaintenant(new Date()), 30_000);
    return () => window.clearInterval(minuteur);
  }, []);

  const taches = f.donnees ?? [];
  const modifier = useCallback(
    (g: (liste: Tache[]) => Tache[]) => { void f.modifier(g); },
    [f],
  );

  const basculer = (id: string) => modifier((l) => l.map((t) => t.id !== id ? t
    : { ...t, faiteLe: estFaite(t) ? "" : clePeriode(t.periode) }));
  const ajouter = (nom: string, periode: Periode) => modifier((l) => [
    ...l, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, nom, periode, faiteLe: "" }]);
  const supprimer = (id: string) => modifier((l) => l.filter((t) => t.id !== id));
  const tout = (fait: boolean) => modifier((l) => l.map((t) => ({ ...t, faiteLe: fait ? clePeriode(t.periode) : "" })));

  return {
    taches, maintenant, basculer, ajouter, supprimer, tout,
    dossier: f.dossier, horsLigne: f.horsLigne, chargement: f.chargement, erreur: f.erreur, relire: f.relire,
  };
}
