import { useEffect, useRef } from "react";
import { closeWindow, rememberOverlayGeometry, useAutoHeight, type ToolScreenProps } from "../../shared/hub";
import { ListeTaches } from "./Liste";
import { estFaite, useChecklist } from "./store";

/** Fenetre flottante : les taches du jour, a cocher sans quitter le jeu. */
export function ChecklistOverlay({ tool }: ToolScreenProps) {
  const { taches, maintenant, basculer, dossier, chargement } = useChecklist();
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useAutoHeight(frameRef, scrollerRef, contentRef);

  useEffect(() => {
    let off: (() => void) | undefined;
    rememberOverlayGeometry(tool.id).then((f) => { off = f; });
    return () => off?.();
  }, [tool.id]);

  const faites = taches.filter((t) => estFaite(t, maintenant)).length;

  return (
    <div ref={frameRef} className="overlay chk-overlay">
      <header className="overlay-bar" data-tauri-drag-region>
        <span className="overlay-title" data-tauri-drag-region>Checklist {faites}/{taches.length}</span>
        <button className="btn-ghost" onClick={() => closeWindow()} title="Close">✕</button>
      </header>
      <div ref={scrollerRef} className="overlay-body">
        <div ref={contentRef} className="chk-page">
          {/* Pas d'espace choisi : la fenetre flottante ne propose pas la
              configuration, elle renvoie vers l'ecran de l'outil. */}
          {!dossier && !chargement && <p className="hint">Set up Nextcloud sync in the Checklist screen.</p>}
          <ListeTaches taches={taches} maintenant={maintenant} basculer={basculer} />
        </div>
      </div>
    </div>
  );
}
