import { useEffect, useState } from "react";
import { closeWindow, overlayKey, rememberOverlayGeometry, type ToolScreenProps } from "../../shared/hub";
import { NoteCard } from "./NoteCard";
import { useNotes } from "./store";

/** Opacite commune a toutes les notes flottantes, comme les autres overlays. */
const OPACITY_KEY = "overlay-opacity:sticky-notes";

function loadOpacity(): number {
  try {
    const v = Number(localStorage.getItem(OPACITY_KEY));
    return v >= 0.4 && v <= 1 ? v : 0.9;
  } catch {
    return 0.9;
  }
}

/** Fenetre flottante d'une seule note : `view` est son id. */
export function NotesOverlay({ tool, view = "" }: ToolScreenProps) {
  const { notes, modifierNote, supprimer, ajouterImages, retirerImage } = useNotes();
  const [opacity, setOpacity] = useState(loadOpacity);
  const note = notes.find((n) => n.id === view);

  useEffect(() => {
    let off: (() => void) | undefined;
    rememberOverlayGeometry(overlayKey(tool.id, view)).then((f) => { off = f; });
    return () => off?.();
  }, [tool.id, view]);

  useEffect(() => {
    try { localStorage.setItem(OPACITY_KEY, String(opacity)); } catch { /* confort */ }
  }, [opacity]);

  return (
    <div className="overlay note-overlay" style={{ ["--overlay-alpha" as string]: opacity }}>
      <header className="overlay-bar" data-tauri-drag-region>
        <span className="overlay-title" data-tauri-drag-region>{note?.titre || "Note"}</span>
        <input className="overlay-opacity" type="range" min={0.4} max={1} step={0.05} value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))} title="Opacity" />
        <button className="btn-ghost" onClick={() => closeWindow()} title="Close">✕</button>
      </header>
      <div className="overlay-body">
        {note ? (
          <NoteCard note={note} tool={tool}
            modifier={(champs, frappe) => modifierNote(note.id, champs, frappe)}
            supprimer={() => { supprimer(note.id); closeWindow(); }}
            ajouterImages={(fichiers) => ajouterImages(note.id, fichiers)}
            retirerImage={(nom) => retirerImage(note.id, nom)}
            masquerBoutonFlottant
          />
        ) : (
          <p className="hint">This note was deleted.</p>
        )}
      </div>
    </div>
  );
}
