import { useCallback } from "react";
import { useFichierSync } from "../../shared/fichierSync";
import { sync, toast } from "../../shared/hub";
import { enDataUrl, preparer } from "../../shared/photos";

export const ID = "sticky-notes";
export const FICHIER = "notes.json";
export const DOSSIER = "ExziHub/Notes";
/** Images par note : au-dela, la note devient un album et le fichier des notes n'a plus de sens. */
export const IMAGES_MAX = 12;
/** Cle d'avant la synchro : sert de miroir et de reprise (voir fichierSync). */
const CLE = "sticky-notes:notes";

export const COULEURS = ["jaune", "rose", "bleu", "vert", "orange", "violet"] as const;
export type Couleur = typeof COULEURS[number];

export interface Note {
  id: string;
  titre: string;
  texte: string;
  couleur: Couleur;
  /** Taille choisie a la souris dans la grille du hub (px). */
  largeur?: number;
  hauteur?: number;
  /**
   * Noms des images de la note. Chaque image est un fichier a part dans le meme espace Nextcloud
   * (reduite a 1600 px, voir shared/photos.ts) : notes.json ne porte que les noms, il reste petit.
   */
  images?: string[];
}

/** Images deja lues : une image ne change jamais (son nom est unique), donc pas d'invalidation. */
const imagesLues = new Map<string, Promise<string | null>>();

/** L'image en data URL, lue une seule fois ; null si le fichier n'existe plus sur Nextcloud. */
export function lireImage(nom: string): Promise<string | null> {
  let p = imagesLues.get(nom);
  if (!p) {
    p = sync.lireOctets(ID, nom).then((b64) => (b64 ? enDataUrl(b64) : null));
    // Un echec de lecture (hors ligne) ne doit pas rester en memoire : la prochaine tentative relira.
    p.catch(() => imagesLues.delete(nom));
    imagesLues.set(nom, p);
  }
  return p;
}

/** Tolere un fichier vide, corrompu ou d'une autre forme plutot que de casser l'ecran. */
function analyser(texte: string): Note[] {
  try {
    const liste = JSON.parse(texte) as unknown;
    return Array.isArray(liste) ? (liste as Note[]) : [];
  } catch {
    return [];
  }
}

/**
 * Notes sur Nextcloud (notes.json) : le fichier est la source de verite, relu
 * avant chaque ecriture. L'ordre du tableau est l'ordre d'affichage.
 *
 * La saisie de texte passe par `modifierPlusTard` : l'affichage suit la frappe,
 * l'ecriture part apres une pause. Les actions franches (creer, supprimer,
 * reordonner, changer de couleur) ecrivent tout de suite.
 */
export function useNotes() {
  const f = useFichierSync<Note[]>({
    id: ID, fichier: FICHIER, cleLocale: CLE, vide: () => [], analyser,
  });

  const notes = f.donnees ?? [];
  const modifier = useCallback((g: (l: Note[]) => Note[]) => { void f.modifier(g); }, [f]);

  const ajouter = () => modifier((l) => [
    ...l, {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      titre: "", texte: "", couleur: COULEURS[l.length % COULEURS.length],
    },
  ]);
  /** `frappe` : saisie au clavier, donc ecriture differee. */
  const modifierNote = (id: string, champs: Partial<Omit<Note, "id">>, frappe = false) => {
    const g = (l: Note[]) => l.map((n) => n.id === id ? { ...n, ...champs } : n);
    if (frappe) f.modifierPlusTard(g); else modifier(g);
  };
  /** Supprime un fichier image de Nextcloud ; l'echec est signale, la note n'y fait plus reference. */
  const effacerFichiers = (noms: string[]) => {
    for (const nom of noms) {
      imagesLues.delete(nom);
      sync.supprimer(ID, nom).catch((e: unknown) => toast(`Could not delete ${nom}: ${e instanceof Error ? e.message : String(e)}`, "erreur"));
    }
  };
  const supprimer = (id: string) => {
    const images = notes.find((n) => n.id === id)?.images ?? [];
    modifier((l) => l.filter((n) => n.id !== id));
    effacerFichiers(images);
  };
  /**
   * Reduit et envoie les images d'abord, puis les ajoute a la note : un echec en route ne laisse
   * jamais une note qui pointe vers un fichier absent. Rend le nombre d'images ajoutees.
   */
  const ajouterImages = async (id: string, fichiers: File[]): Promise<number> => {
    const deja = notes.find((n) => n.id === id)?.images?.length ?? 0;
    const retenus = fichiers.slice(0, Math.max(0, IMAGES_MAX - deja));
    if (retenus.length < fichiers.length) toast(`A note holds at most ${IMAGES_MAX} images`, "erreur");
    const noms: string[] = [];
    try {
      for (const fichier of retenus) {
        const nom = `${id}-${Date.now().toString(36)}${noms.length}.jpg`;
        if ((await sync.ecrireOctets(ID, nom, await preparer(fichier), null)) === null) throw new Error(`${nom} already exists`);
        noms.push(nom);
      }
    } finally {
      // Meme en cas d'echec au milieu, les images deja envoyees sont rattachees plutot qu'orphelines.
      if (noms.length > 0) modifier((l) => l.map((n) => (n.id === id ? { ...n, images: [...(n.images ?? []), ...noms] } : n)));
    }
    return noms.length;
  };
  const retirerImage = (id: string, nom: string) => {
    modifier((l) => l.map((n) => (n.id === id ? { ...n, images: (n.images ?? []).filter((i) => i !== nom) } : n)));
    effacerFichiers([nom]);
  };
  const deplacer = (depuisId: string, versId: string) => modifier((l) => {
    if (depuisId === versId) return l;
    const depuis = l.findIndex((n) => n.id === depuisId);
    const vers = l.findIndex((n) => n.id === versId);
    if (depuis === -1 || vers === -1) return l;
    const suivant = [...l];
    const [n] = suivant.splice(depuis, 1);
    suivant.splice(vers, 0, n);
    return suivant;
  });

  return {
    notes, ajouter, modifierNote, supprimer, deplacer, ajouterImages, retirerImage,
    dossier: f.dossier, horsLigne: f.horsLigne, chargement: f.chargement,
    erreur: f.erreur, enAttente: f.enAttente, relire: f.relire,
  };
}
