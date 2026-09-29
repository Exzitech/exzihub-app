/** Categories affichees dans l'ordre ; un outil sans categorie connue va dans "other". */
export const CATEGORIES = [
  { id: "games", label: "Games" },
  { id: "office", label: "Office" },
  { id: "family", label: "Family" },
  { id: "other", label: "Other" },
] as const;

interface Classable { category?: string; subcategory?: string }

/**
 * Regroupe par categorie, dans l'ordre de CATEGORIES, en omettant les groupes vides.
 * Dans une categorie, les outils sans sous-categorie viennent d'abord (`items`), puis un
 * sous-groupe par sous-categorie libre du manifest (ex. "Jeux"), par ordre alphabetique.
 */
export function groupByCategory<T extends Classable>(items: T[]) {
  const known = (c?: string) => CATEGORIES.some((k) => k.id === c);
  return CATEGORIES
    .map(({ id, label }) => {
      const dedans = items.filter((i) => (known(i.category) ? i.category : "other") === id);
      const sous = [...new Set(dedans.map((i) => i.subcategory).filter((s): s is string => !!s))].sort();
      return {
        id, label,
        items: dedans.filter((i) => !i.subcategory),
        subgroups: sous.map((s) => ({ id: `${id}.${s}`, label: s, items: dedans.filter((i) => i.subcategory === s) })),
      };
    })
    .filter((g) => g.items.length > 0 || g.subgroups.length > 0);
}
