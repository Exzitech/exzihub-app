import { useEffect, useRef, useState } from "react";
import { canOpenOverlay, openOverlay, toast, type ToolConfig } from "../../shared/hub";
import { COULEURS, IMAGES_MAX, lireImage, type Couleur, type Note } from "./store";

interface Props {
  note: Note;
  tool: ToolConfig;
  /** `frappe` : saisie au clavier, l'ecriture Nextcloud est differee. */
  modifier(champs: Partial<Omit<Note, "id">>, frappe?: boolean): void;
  supprimer(): void;
  ajouterImages(fichiers: File[]): Promise<number>;
  retirerImage(nom: string): void;
  draggable?: boolean;
  onDragStartId?(id: string): void;
  onDropId?(id: string): void;
  masquerBoutonFlottant?: boolean;
}

/** Corbeille en trait : l'emoji poubelle rendait une image couleur minuscule et floue. */
function Corbeille() {
  return (
    <svg className="note-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

/** Image en trait, pour la meme raison que la corbeille. */
function IconeImage() {
  return (
    <svg className="note-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 9" />
    </svg>
  );
}

const estImage = (f: File) => f.type.startsWith("image/");

/** Vignette chargee a l'affichage seulement : une note ancienne ne coute rien tant qu'on ne la voit pas. */
function Vignette({ nom, onOuvrir }: { nom: string; onOuvrir(src: string): void }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivant = true;
    lireImage(nom).then((s) => { if (vivant) setSrc(s); }).catch(() => { if (vivant) setSrc(null); });
    return () => { vivant = false; };
  }, [nom]);
  if (src === undefined) return <div className="note-vignette note-vignette-attente" />;
  if (src === null) return <div className="note-vignette note-vignette-absente" title="Image not found on Nextcloud">?</div>;
  return <img className="note-vignette" src={src} alt="" title="View" onClick={() => onOuvrir(src)} />;
}

/** Image en plein ecran, avec la suppression definitive (elle efface le fichier sur Nextcloud). */
function Agrandie({ src, onFermer, onRetirer }: { src: string; onFermer(): void; onRetirer(): void }) {
  const [arme, setArme] = useState(false);
  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === "Escape") onFermer(); };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [onFermer]);
  return (
    <div className="note-plein" onClick={onFermer}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="note-plein-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => (arme ? onRetirer() : setArme(true))} className={arme ? "btn-danger" : ""}>
          {arme ? "Really delete this image?" : "Delete image"}
        </button>
        <button onClick={onFermer}>Close</button>
      </div>
    </div>
  );
}

export function NoteCard({
  note, tool, modifier, supprimer, ajouterImages, retirerImage, draggable, onDragStartId, onDropId, masquerBoutonFlottant,
}: Props) {
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [agrandie, setAgrandie] = useState<{ nom: string; src: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const choix = useRef<HTMLInputElement>(null);
  const avant = useRef<[number, number]>([0, 0]);
  const images = note.images ?? [];

  // Redimensionnement (poignee CSS) : on ne memorise que si la taille a change
  // entre l'appui et le relachement de la souris.
  const memoriser = () => {
    const el = ref.current;
    if (!el || !draggable) return;
    const [w, h] = [Math.round(el.offsetWidth), Math.round(el.offsetHeight)];
    if (Math.abs(w - avant.current[0]) > 1 || Math.abs(h - avant.current[1]) > 1) modifier({ largeur: w, hauteur: h });
  };

  const envoyer = async (fichiers: File[]) => {
    const retenus = fichiers.filter(estImage);
    if (retenus.length === 0) return;
    setEnvoi(true);
    try {
      await ajouterImages(retenus);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "erreur");
    } finally {
      setEnvoi(false);
    }
  };

  // Coller une capture ou une image copiee : le texte collé garde son comportement normal.
  const colle = (e: React.ClipboardEvent) => {
    const fichiers = Array.from(e.clipboardData.files).filter(estImage);
    if (fichiers.length === 0) return;
    e.preventDefault();
    void envoyer(fichiers);
  };

  const depose = (e: React.DragEvent) => {
    e.preventDefault();
    // Des fichiers venus de l'explorateur : images de la note. Sinon, c'est le reordonnancement des notes.
    if (e.dataTransfer.files.length > 0) void envoyer(Array.from(e.dataTransfer.files));
    else if (draggable) onDropId?.(note.id);
  };

  return (
    <div
      ref={ref}
      className={`note note-${note.couleur} ${draggable ? "note-libre" : ""}`}
      style={draggable && note.largeur ? { width: note.largeur, height: note.hauteur } : undefined}
      onPointerDown={() => { if (ref.current) avant.current = [ref.current.offsetWidth, ref.current.offsetHeight]; }}
      onPointerUp={memoriser}
      onDragOver={(e) => e.preventDefault()}
      onDrop={depose}
      onPaste={colle}
    >
      <div className="note-bar">
        {draggable && (
          <span className="note-poignee" draggable title="Reorder"
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStartId?.(note.id); }}>⠿</span>
        )}
        <div className="note-couleurs">
          {COULEURS.map((c) => (
            <button key={c} type="button" className={`note-pastille note-pastille-${c} ${c === note.couleur ? "is-active" : ""}`}
              title={c} onClick={() => modifier({ couleur: c as Couleur })} />
          ))}
        </div>
        <button className="btn-ghost note-supprimer" type="button" disabled={envoi || images.length >= IMAGES_MAX}
          title={envoi ? "Uploading…" : "Add images (or paste / drop them)"} aria-label="Add images"
          onClick={() => choix.current?.click()}>
          <IconeImage />
        </button>
        <input ref={choix} type="file" accept="image/*" multiple hidden
          onChange={(e) => { void envoyer(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {canOpenOverlay && !masquerBoutonFlottant && (
          <button className="btn-ghost" title="Open in a floating window"
            onClick={() => openOverlay(tool, note.id, note.titre || "note")}>⧉</button>
        )}
        {confirmation ? (
          <span className="note-confirm">
            <button className="btn-ghost" onClick={supprimer} title="Confirm delete">✓</button>
            <button className="btn-ghost" onClick={() => setConfirmation(false)} title="Cancel">✕</button>
          </span>
        ) : (
          <button className="btn-ghost note-supprimer" title="Delete"
            aria-label="Delete" onClick={() => setConfirmation(true)}><Corbeille /></button>
        )}
      </div>
      <input className="note-titre" placeholder="Title…" value={note.titre}
        onChange={(e) => modifier({ titre: e.target.value }, true)} />
      <textarea className="note-texte" placeholder="Write here…" value={note.texte}
        onChange={(e) => modifier({ texte: e.target.value }, true)} />
      {(images.length > 0 || envoi) && (
        <div className="note-images">
          {images.map((nom) => <Vignette key={nom} nom={nom} onOuvrir={(src) => setAgrandie({ nom, src })} />)}
          {envoi && <div className="note-vignette note-vignette-attente" title="Uploading…" />}
        </div>
      )}
      {agrandie && (
        <Agrandie src={agrandie.src} onFermer={() => setAgrandie(null)}
          onRetirer={() => { retirerImage(agrandie.nom); setAgrandie(null); }} />
      )}
    </div>
  );
}
