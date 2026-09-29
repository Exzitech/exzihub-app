// Types de window.ExziHub, l'API que le hub fournit aux plugins (hub/src/plugins.ts).
import type { ComponentType, RefObject } from "react";

export interface ToolConfig {
  id: string;
  name: string;
  icon?: string;
  version?: string;
  /** Port du moteur local ; absent pour un plugin sans moteur. */
  port?: number;
}

export type SocketStatus = "connecting" | "open" | "closed";

/** Un message du moteur : seul `type` est garanti, le reste depend du type. */
export interface ToolMessage {
  type: string;
  [key: string]: unknown;
}

export type MessageHandlers = Record<string, (msg: ToolMessage) => void>;

export interface ToolScreenProps {
  tool: ToolConfig;
  /** Fenetre flottante : vue demandee ("" = vue par defaut de l'outil). */
  view?: string;
}

export interface PluginExports {
  Tool: ComponentType<ToolScreenProps>;
  Overlay?: ComponentType<ToolScreenProps>;
}

export interface SyncEtat {
  /** "utilisateur@serveur" si un compte Nextcloud est connecte. */
  compte: string | null;
  /** Espace du plugin, null tant qu'il n'est pas choisi. */
  espace: { mode: "compte"; dossier: string } | { mode: "lien"; lien: string } | null;
  /** Vrai si la veille (notifications) de ce plugin est active. */
  veille: boolean;
}

/** Un fichier de l'espace du plugin, vu par `sync.lister`. */
export interface Fichier {
  nom: string;
  version: string;
  taille: number;
}

export interface Lu {
  texte: string;
  version: string;
  /** Nextcloud injoignable : derniere copie connue. */
  horsLigne: boolean;
}

interface HubApi {
  register(id: string, plugin: PluginExports): void;
  PinButton: ComponentType;
  openOverlay(tool: ToolConfig, view?: string, title?: string): Promise<void>;
  /** Identifiant de la fenetre flottante d'un outil (une par vue). */
  overlayKey(toolId: string, view?: string): string;
  canOpenOverlay: boolean;
  rememberOverlayGeometry(key: string): Promise<() => void>;
  useAutoHeight(
    frame: RefObject<HTMLElement>,
    scroller: RefObject<HTMLElement>,
    content: RefObject<HTMLElement>,
  ): void;
  closeWindow(): Promise<void>;
  saveFileAs(name: string, bytes: Uint8Array): Promise<string | null>;
  /**
   * WebSocket du moteur du plugin, vivant tant que le composant est monte :
   * chaque message est route vers `handlers[msg.type]`, reconnexion automatique.
   */
  useToolSocket(url: string, handlers: MessageHandlers): { status: SocketStatus; send(payload: object): boolean };
  /** Bouton lancer/arreter le moteur ; ne s'affiche que si le plugin en declare un. */
  LaunchButton: ComponentType<{ tool: ToolConfig; compact?: boolean }>;
  /**
   * Ecrit un fichier texte dans Telechargements ; renvoie son chemin.
   * Le hub affiche lui-meme la confirmation : ne pas en ajouter une seconde.
   */
  exportFile(name: string, contents: string): Promise<string>;
  /** Confirmation passagere en bas de l'ecran ; visible meme si la page est defilee. */
  toast(texte: string, type?: "ok" | "erreur"): void;
  /**
   * Synchro Nextcloud (WebDAV), meme code sur PC et Android. Aucune ecriture aveugle :
   * `ecrire` exige la version lue (ou null pour un fichier nouveau) et renvoie null en cas de
   * conflit ; `modifier` relit et recommence tout seul. Hors ligne, `lire` rend la derniere
   * copie connue (`horsLigne`) et toute ecriture echoue explicitement.
   */
  sync: {
    etat(id: string): Promise<SyncEtat>;
    lire(id: string, nom: string): Promise<Lu | null>;
    ecrire(id: string, nom: string, texte: string, version: string | null): Promise<string | null>;
    modifier(id: string, nom: string, f: (texte: string | null) => string): Promise<string>;
    /** Fichiers de l'espace du plugin, en un seul aller-retour ; echoue hors ligne. */
    lister(id: string): Promise<Fichier[]>;
    /** Contenu binaire (photo...) en base64 ; null s'il n'existe pas. Pas de cache hors ligne. */
    lireOctets(id: string, nom: string): Promise<string | null>;
    ecrireOctets(id: string, nom: string, contenu: string, version: string | null): Promise<string | null>;
    /** Supprime un fichier ; sans effet s'il n'existe plus. */
    supprimer(id: string, nom: string): Promise<void>;
    /**
     * Veille : le hub surveille l'espace du plugin toutes les 5 minutes, meme ecran ferme,
     * et notifie les fichiers `prefixe*` apparus ({n} = leur nombre dans `message`).
     * Demande l'autorisation systeme a l'activation et echoue si elle est refusee.
     */
    veille(id: string, titre: string, message: string, prefixe: string, actif: boolean): Promise<void>;
  };
  /** Connexion Nextcloud et choix de l'espace du plugin ; `lien` autorise un lien de partage. */
  SyncSetup: ComponentType<{ id: string; dossierParDefaut: string; lien?: boolean; onChange?: () => void }>;
}

const hub = (window as unknown as { ExziHub: HubApi }).ExziHub;

export const {
  register, PinButton, openOverlay, overlayKey, canOpenOverlay, rememberOverlayGeometry, useAutoHeight,
  closeWindow, saveFileAs,
  useToolSocket, LaunchButton, exportFile, toast, sync, SyncSetup,
} = hub;
