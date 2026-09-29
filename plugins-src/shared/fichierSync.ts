import { useCallback, useEffect, useRef, useState } from "react";
import { sync } from "./hub";

/**
 * Stockage « cloud d'abord » pour un plugin dont les donnees tiennent dans un
 * seul fichier JSON : meme protocole que Budget, Carnet, Croissance et Routines.
 * Le fichier Nextcloud est la source de verite ; chaque modification le relit
 * juste avant d'ecrire (`sync.modifier`), donc un changement fait sur un autre
 * appareil n'est jamais ecrase.
 *
 * Deux services en plus, pour les plugins qui stockaient jusqu'ici en local :
 *
 * - **Reprise des donnees locales.** Au premier branchement d'un espace, si le
 *   fichier distant n'existe pas encore, le contenu deja present dans
 *   localStorage y est pousse. Rien n'est efface : l'ancienne cle reste en place.
 *   Si le distant existe deja ET que le local en differe, le local est recopie
 *   une fois sous `<cle>:avant-synchro` avant d'etre remplace — on ne perd pas
 *   silencieusement ce qui n'aurait pas ete synchronise.
 *
 * - **Modification locale prioritaire.** Tant qu'une ecriture est en attente ou
 *   en vol, aucun rafraichissement (minuteur, retour de focus, autre fenetre) ne
 *   revient a l'affichage : le distant ne contient pas encore ce qui vient d'etre
 *   fait. L'ecriture relit et fusionne, elle ne perd donc rien. Quitter la
 *   fenetre (blur) envoie tout de suite ce qui attend.
 *
 * - **Miroir local.** La derniere version connue est recopiee dans localStorage.
 *   Elle ne sert pas de source de verite, mais l'evenement `storage` previent
 *   l'autre fenetre (hub <-> fenetre flottante) sans attendre le rafraichissement.
 */
const RAFRAICHIR_MS = 60_000;
/** Silence au clavier avant d'ecrire sur Nextcloud. */
const ATTENTE_MS = 800;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function lireLocal(cle: string): string | null {
  try { return localStorage.getItem(cle); } catch { return null; }
}

function ecrireLocal(cle: string, texte: string): void {
  try { localStorage.setItem(cle, texte); } catch { /* confort : le miroir n'est pas vital */ }
}

export interface FichierSync<T> {
  /** null tant que le fichier n'est pas charge, ou qu'aucun espace n'est choisi. */
  donnees: T | null;
  /** Dossier ou lien Nextcloud ; null tant qu'il n'est pas choisi (afficher SyncSetup). */
  dossier: string | null;
  /** Nextcloud injoignable : derniere copie connue, en lecture seule. */
  horsLigne: boolean;
  chargement: boolean;
  erreur: string | null;
  /** A appeler apres un changement d'espace (SyncSetup). */
  relire(): Promise<void>;
  /** Applique `f` a la derniere version du fichier (relue juste avant) puis l'ecrit. */
  modifier(f: (d: T) => T): Promise<void>;
  /**
   * Comme `modifier`, mais l'ecriture attend `ATTENTE_MS` sans nouvelle
   * modification : pour du texte saisi au clavier, ou chaque frappe declencherait
   * sinon un aller-retour Nextcloud. Les transformations en attente sont
   * composees, puis appliquees d'un bloc a la version fraichement relue du
   * fichier — la regle « relire avant d'ecrire » tient donc toujours.
   */
  modifierPlusTard(f: (d: T) => T): void;
  /** Vrai tant qu'une ecriture differee n'est pas partie (afficher « enregistrement… »). */
  enAttente: boolean;
}

export interface OptionsFichierSync<T> {
  /** Identifiant du plugin (espace de synchro). */
  id: string;
  /** Nom du fichier dans l'espace, par exemple "chemins.json". */
  fichier: string;
  /** Valeur d'un fichier absent. */
  vide: () => T;
  /** Lit le texte du fichier ; doit tolerer un contenu inattendu. */
  analyser: (texte: string) => T;
  /**
   * Cle localStorage ou est recopiee la derniere version connue (miroir). Quand
   * l'ancien stockage du plugin avait deja cette forme, reutiliser sa cle : elle
   * reste ainsi a jour, et sert aussi de reprise. Sinon, en choisir une nouvelle
   * et fournir `reprendreLocal` — le miroir ecrase sa cle.
   */
  cleLocale: string;
  /**
   * Donnees d'avant la synchro, a pousser si le fichier distant n'existe pas
   * encore. A defaut, le contenu de `cleLocale` est repris tel quel. Cette
   * fonction ne doit que LIRE les anciennes cles, jamais les effacer : elles
   * restent en place comme filet.
   */
  reprendreLocal?: () => T | null;
}

export function useFichierSync<T>(o: OptionsFichierSync<T>): FichierSync<T> {
  const { id, fichier, vide, analyser, cleLocale, reprendreLocal } = o;
  const [donnees, setDonnees] = useState<T | null>(null);
  const [dossier, setDossier] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  // Serialise les ecritures : deux clics rapides ne se melangent pas.
  const file = useRef<Promise<void>>(Promise.resolve());
  // Dernier texte connu : evite de re-rendre quand le fichier n'a pas bouge.
  const dernier = useRef<string | null>(null);
  // Modification locale pas encore partie (ecriture differee) ou en vol : voir
  // `appliquer`. Declares ici parce que `appliquer` les lit.
  const differee = useRef<((d: T) => T) | null>(null);
  const enVol = useRef(0);

  const appliquer = useCallback((texte: string | null) => {
    // Une modification locale attend son ecriture (ou est en vol) : le fichier
    // distant ne la contient pas encore. L'appliquer rendrait l'ancien etat a
    // l'ecran — un retour de focus effacerait la derniere saisie. L'ecriture
    // relit et fusionne de toute facon, on garde donc l'affichage local.
    if (differee.current || enVol.current > 0) return;
    if (texte === dernier.current) return;
    dernier.current = texte;
    setDonnees(texte === null ? vide() : analyser(texte));
    if (texte !== null) ecrireLocal(cleLocale, texte);
  }, [analyser, cleLocale, vide]);

  const recharger = useCallback(async () => {
    try {
      const lu = await sync.lire(id, fichier);
      if (lu === null) {
        // Fichier distant absent : premiere synchro. On y pousse ce que le
        // plugin avait en local, sans jamais toucher a l'ancienne cle.
        const local = lireLocal(cleLocale);
        const repris = reprendreLocal ? reprendreLocal() : (local === null ? null : analyser(local));
        if (repris !== null) {
          const texte = JSON.stringify(repris, null, 2);
          await sync.ecrire(id, fichier, texte, null);
          dernier.current = texte;
          setDonnees(repris);
        } else {
          appliquer(null);
        }
        setHorsLigne(false);
      } else {
        const local = lireLocal(cleLocale);
        if (local !== null && local !== lu.texte && lireLocal(`${cleLocale}:avant-synchro`) === null) {
          // Le distant gagne, mais on garde une copie de ce qui existait ici.
          ecrireLocal(`${cleLocale}:avant-synchro`, local);
        }
        appliquer(lu.texte);
        setHorsLigne(lu.horsLigne);
      }
      setErreur(null);
    } catch (e) {
      setErreur(message(e));
    }
  }, [analyser, appliquer, cleLocale, fichier, id, reprendreLocal]);

  const relire = useCallback(async () => {
    try {
      const { espace } = await sync.etat(id);
      const ou = espace ? (espace.mode === "compte" ? espace.dossier : espace.lien) : null;
      setDossier(ou);
      if (ou) await recharger();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setChargement(false);
    }
  }, [id, recharger]);

  useEffect(() => { void relire(); }, [relire]);

  useEffect(() => {
    if (!dossier) return;
    const minuteur = window.setInterval(recharger, RAFRAICHIR_MS);
    // L'autre fenetre du plugin (flottante) ecrit le miroir : on suit sans attendre.
    const surStockage = (e: StorageEvent) => {
      if (e.key === cleLocale && e.newValue !== null) appliquer(e.newValue);
    };
    window.addEventListener("focus", recharger);
    window.addEventListener("storage", surStockage);
    return () => {
      window.clearInterval(minuteur);
      window.removeEventListener("focus", recharger);
      window.removeEventListener("storage", surStockage);
    };
  }, [appliquer, cleLocale, dossier, recharger]);

  const modifier = useCallback((f: (d: T) => T) => {
    enVol.current++;
    const tache = file.current.then(async () => {
      try {
        let suivant: T | null = null;
        let texte = "";
        await sync.modifier(id, fichier, (courant) => {
          suivant = f(courant === null ? vide() : analyser(courant));
          texte = JSON.stringify(suivant, null, 2);
          return texte;
        });
        dernier.current = texte;
        ecrireLocal(cleLocale, texte);
        // Le resultat ecrit ne remplace l'affichage que s'il est le plus recent :
        // une modification faite pendant le vol (ou en attente d'envoi) serait
        // sinon effacee de l'ecran jusqu'a sa propre ecriture.
        if (enVol.current === 1 && !differee.current) setDonnees(suivant);
        setHorsLigne(false);
        setErreur(null);
      } catch (e) {
        setErreur(`Non enregistré : ${message(e)}`);
      } finally {
        enVol.current--;
      }
    });
    file.current = tache;
    return tache;
  }, [analyser, cleLocale, fichier, id, vide]);

  // Minuteur de l'ecriture differee (sa transformation : `differee`, plus haut).
  const minuteur = useRef<number | null>(null);
  const [enAttente, setEnAttente] = useState(false);

  /** Envoie tout de suite la transformation en attente, sans attendre le silence. */
  const envoyerMaintenant = useCallback(() => {
    if (minuteur.current !== null) window.clearTimeout(minuteur.current);
    minuteur.current = null;
    const g = differee.current;
    differee.current = null;
    if (g) void modifier(g).finally(() => setEnAttente(false));
    else setEnAttente(false);
  }, [modifier]);

  // Quitter la fenetre (alt-tab vers le jeu) : l'ecriture part sans attendre,
  // pour qu'il ne reste rien en attente au retour.
  useEffect(() => {
    window.addEventListener("blur", envoyerMaintenant);
    return () => window.removeEventListener("blur", envoyerMaintenant);
  }, [envoyerMaintenant]);

  const modifierPlusTard = useCallback((f: (d: T) => T) => {
    const precedent = differee.current;
    differee.current = precedent ? (d: T) => f(precedent(d)) : f;
    // Affichage immediat : l'utilisateur voit sa frappe sans attendre l'ecriture.
    setDonnees((courant) => (courant === null ? courant : f(courant)));
    setEnAttente(true);
    if (minuteur.current !== null) window.clearTimeout(minuteur.current);
    minuteur.current = window.setTimeout(envoyerMaintenant, ATTENTE_MS);
  }, [envoyerMaintenant]);

  // Demontage (fermeture de la fenetre flottante) : ne pas perdre la saisie en cours.
  useEffect(() => () => {
    if (minuteur.current !== null) window.clearTimeout(minuteur.current);
    const g = differee.current;
    differee.current = null;
    if (g) void modifier(g);
  }, [modifier]);

  return { donnees, dossier, horsLigne, chargement, erreur, relire, modifier, modifierPlusTard, enAttente };
}
