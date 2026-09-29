import { useState } from "react";
import { PinButton, SyncSetup, canOpenOverlay, openOverlay, type ToolScreenProps } from "../../shared/hub";
import { ListeTaches } from "./Liste";
import { DOSSIER, ID, estFaite, useChecklist, type Periode } from "./store";

export function ChecklistTool({ tool }: ToolScreenProps) {
  const c = useChecklist();
  const { taches, maintenant, basculer, ajouter, supprimer, tout } = c;
  const [nom, setNom] = useState("");
  const [periode, setPeriode] = useState<Periode>("jour");
  const faites = taches.filter((t) => estFaite(t, maintenant)).length;

  const submit = () => {
    if (!nom.trim()) return;
    ajouter(nom.trim(), periode);
    setNom("");
  };

  // Tant qu'aucun espace n'est choisi, l'ecran sert a en choisir un : les taches
  // vivent sur Nextcloud pour suivre d'un appareil a l'autre.
  if (c.chargement) return <p className="hint">Loading…</p>;
  if (!c.dossier) {
    return (
      <div className="outil">
        <header className="outil-barre"><div className="toolbar-title"><h2>{tool.name}</h2></div></header>
        <p className="hint">Choose a Nextcloud space: your tasks follow you from one device to another.</p>
        <SyncSetup id={ID} dossierParDefaut={DOSSIER} lien onChange={c.relire} />
      </div>
    );
  }

  return (
    <div className="outil">
      <header className="outil-barre">
        <div className="toolbar-title">
          <h2>{tool.name}</h2>
          <span className="muted">{faites}/{taches.length} done</span>
        </div>
        <div className="toolbar-actions">
          {canOpenOverlay && (
            <button onClick={() => openOverlay(tool, "", "")} title="Show the checklist in a floating window on top of other apps">
              ⧉ Floating window
            </button>
          )}
          <button onClick={() => tout(false)}>Uncheck all</button>
          <PinButton />
        </div>
      </header>

      {c.horsLigne && <div className="banner banner-warn">Nextcloud unreachable: showing the last known copy, read-only.</div>}
      {c.erreur && <div className="banner banner-alert">{c.erreur}</div>}

      <div className="chk-page">
        <ListeTaches taches={taches} maintenant={maintenant} basculer={basculer} supprimer={supprimer} />
        <form className="chk-ajout" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="New task…" />
          <select value={periode} onChange={(e) => setPeriode(e.target.value as Periode)}>
            <option value="jour">Daily (resets at midnight)</option>
            <option value="semaine">Weekly (resets on Monday)</option>
            <option value="manuel">Manual (never resets)</option>
          </select>
          <button type="submit" className="btn-primary" disabled={!nom.trim()}>Add</button>
        </form>
        <p className="hint">Daily and weekly tasks uncheck themselves at the end of their period (local time); manual tasks stay as you left them.</p>
      </div>
    </div>
  );
}
