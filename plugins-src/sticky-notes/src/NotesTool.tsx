import { useState } from "react";
import { PinButton, SyncSetup, type ToolScreenProps } from "../../shared/hub";
import { NoteCard } from "./NoteCard";
import { DOSSIER, ID, useNotes } from "./store";

export function NotesTool({ tool }: ToolScreenProps) {
  const n0 = useNotes();
  const { notes, ajouter, modifierNote, supprimer, deplacer, ajouterImages, retirerImage } = n0;
  const [glissee, setGlissee] = useState<string | null>(null);

  // Tant qu'aucun espace n'est choisi, l'ecran sert a en choisir un.
  if (n0.chargement) return <p className="hint">Loading…</p>;
  if (!n0.dossier) {
    return (
      <div className="outil">
        <header className="outil-barre"><div className="toolbar-title"><h2>{tool.name}</h2></div></header>
        <p className="hint">Choose a Nextcloud space: your notes follow you from one device to another.</p>
        <SyncSetup id={ID} dossierParDefaut={DOSSIER} lien onChange={n0.relire} />
      </div>
    );
  }

  return (
    <div className="outil">
      <header className="outil-barre">
        <div className="toolbar-title">
          <h2>{tool.name}</h2>
          <span className="muted">{notes.length}</span>
        </div>
        <div className="toolbar-actions">
          {n0.enAttente && <span className="muted">Saving…</span>}
          <button className="btn-primary" onClick={ajouter}>+ New note</button>
          <PinButton />
        </div>
      </header>

      {n0.horsLigne && <div className="banner banner-warn">Nextcloud unreachable: showing the last known copy, read-only.</div>}
      {n0.erreur && <div className="banner banner-alert">{n0.erreur}</div>}

      {notes.length === 0 ? (
        <p className="hint">No notes yet.</p>
      ) : (
        <div className="note-grille">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} tool={tool}
              modifier={(champs, frappe) => modifierNote(n.id, champs, frappe)}
              supprimer={() => supprimer(n.id)}
              ajouterImages={(fichiers) => ajouterImages(n.id, fichiers)}
              retirerImage={(nom) => retirerImage(n.id, nom)}
              draggable
              onDragStartId={setGlissee}
              onDropId={(id) => { if (glissee) deplacer(glissee, id); setGlissee(null); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
