import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

/** Espace Nextcloud d'un plugin : dossier du compte connecte, ou lien de partage public. */
export type Espace =
  | { mode: "compte"; dossier: string }
  | { mode: "lien"; lien: string; motDePasse?: string };

export interface SyncEtat {
  /** "utilisateur@serveur" si un compte est connecte. */
  compte: string | null;
  /** Espace du plugin (sans mot de passe), null s'il n'est pas encore choisi. */
  espace: { mode: "compte"; dossier: string } | { mode: "lien"; lien: string } | null;
}

export interface Lu {
  texte: string;
  version: string;
  /** Nextcloud injoignable : derniere copie connue. */
  horsLigne: boolean;
}

/** Un fichier de l'espace du plugin, vu par `lister`. */
export interface Fichier {
  nom: string;
  version: string;
  taille: number;
}

/** Tentatives quand l'autre appareil ecrit en meme temps (conflit de version). */
const ESSAIS = 5;

/** Synchro Nextcloud (src-tauri/src/synchro.rs), exposee aux plugins dans window.ExziHub.sync. */
export const sync = {
  etat: (id: string) => invoke<SyncEtat>("sync_etat", { id }),
  /** Ouvre la connexion Nextcloud dans le navigateur ; resout une fois autorisee. */
  connecter: (serveur: string) => invoke<string>("sync_connecter", { serveur }),
  annulerConnexion: () => invoke<void>("sync_annuler_connexion"),
  deconnecter: () => invoke<void>("sync_deconnecter"),
  choisir: (id: string, espace: Espace) => invoke<void>("sync_choisir", { id, espace }),
  /** null si le fichier n'existe pas encore. */
  lire: (id: string, nom: string) => invoke<Lu | null>("sync_lire", { id, nom }),
  /**
   * Ecrit si le fichier est toujours a `version` (null : s'il n'existe pas encore).
   * Renvoie la nouvelle version, ou null si le fichier a change ailleurs : relire et recommencer.
   */
  ecrire: (id: string, nom: string, texte: string, version: string | null) =>
    invoke<string | null>("sync_ecrire", { id, nom, texte, version }),

  /** Fichiers de l'espace du plugin, en un seul aller-retour. Echoue hors ligne. */
  lister: (id: string) => invoke<Fichier[]>("sync_lister", { id }),
  /** Contenu binaire (photo...) en base64 ; null si le fichier n'existe pas. Pas de cache hors ligne. */
  lireOctets: (id: string, nom: string) => invoke<string | null>("sync_lire_octets", { id, nom }),
  /** Comme `ecrire`, avec un contenu binaire en base64. */
  ecrireOctets: (id: string, nom: string, contenu: string, version: string | null) =>
    invoke<string | null>("sync_ecrire_octets", { id, nom, contenu, version }),
  /** Supprime un fichier ; sans effet s'il n'existe plus. */
  supprimer: (id: string, nom: string) => invoke<void>("sync_supprimer", { id, nom }),

  /**
   * Veille : le hub regarde l'espace du plugin toutes les 5 minutes, meme quand l'ecran du
   * plugin est ferme, et notifie les fichiers `prefixe*` apparus (`{n}` dans `message`).
   * A l'activation, l'autorisation systeme est demandee : sans elle, Android ignorerait
   * les notifications en silence, donc on echoue plutot que de promettre un rappel.
   */
  async veille(id: string, titre: string, message: string, prefixe: string, actif: boolean): Promise<void> {
    if (actif && !(await isPermissionGranted()) && (await requestPermission()) !== "granted") {
      throw new Error("Notifications refusées pour ExziHub (voir les réglages du système)");
    }
    await invoke<void>("sync_veille", { id, titre, message, prefixe, actif });
  },

  /**
   * Relit le fichier, applique `f` a son contenu (null s'il n'existe pas) et ecrit le resultat ;
   * recommence si un autre appareil l'a modifie entre-temps. Renvoie le texte ecrit.
   */
  async modifier(id: string, nom: string, f: (texte: string | null) => string): Promise<string> {
    for (let essai = 0; essai < ESSAIS; essai++) {
      const lu = await sync.lire(id, nom);
      if (lu?.horsLigne) throw new Error("Pas de connexion à Nextcloud : rien n'a été enregistré");
      const texte = f(lu?.texte ?? null);
      if (await sync.ecrire(id, nom, texte, lu?.version ?? null) !== null) return texte;
    }
    throw new Error("Le fichier change sans cesse sur un autre appareil : rien n'a été enregistré, réessayez");
  },
};
