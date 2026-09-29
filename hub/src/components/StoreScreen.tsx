import { useState } from "react";
import { groupByCategory } from "../categories";
import { CategoryGroup } from "./CategoryGroup";
import { ToolIcon } from "../icons";
import { isMobile } from "../platform";
import type { ToolConfig } from "../registry";
import {
  canUseStore, formatSize, hubUpdate, installPlugin, pluginStatus, uninstallPlugin, updateHub, type Catalog, type CatalogEntry,
} from "../store";

interface Props {
  tools: ToolConfig[];
  catalog: Catalog | null;
  /** Version du hub en cours d'execution. */
  hubVersion: string | null;
  /** Message d'erreur du dernier chargement du catalogue. */
  catalogError: string | null;
  loading: boolean;
  onRefresh: () => void;
  /** Relit les plugins installes apres une installation ou une desinstallation. */
  onChanged: () => Promise<void>;
}

/** Identifiant de l'operation "mise a jour du hub" (elle seule bloque tout l'ecran). */
const HUB = "ExziHub";

/** Ecran "Outils" : installer, mettre a jour et desinstaller les plugins du catalogue. */
export function StoreScreen({ tools, catalog, hubVersion, catalogError, loading, onRefresh, onChanged }: Props) {
  // Un Set, pas un seul id : chaque plugin s'installe dans son propre dossier
  // (cote Rust), donc deux telechargements peuvent avancer en parallele.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hubBusy = busy.has(HUB);
  const occupe = (id: string) => busy.has(id) || hubBusy;

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy((en) => new Set(en).add(id));
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(`${id} : ${String(err)}`);
    } finally {
      setBusy((en) => {
        const reste = new Set(en);
        reste.delete(id);
        return reste;
      });
    }
  };

  // Plugins installes qui ne sont plus (ou pas encore) dans le catalogue : desinstallables quand meme.
  const orphans = tools.filter((t) => t.plugin && !catalog?.plugins.some((e) => e.id === t.id));
  const nouveauHub = hubUpdate(catalog, hubVersion);

  // Carte d'un plugin du catalogue : etat, installation, mise a jour, desinstallation.
  const carte = (entry: CatalogEntry) => {
    const status = pluginStatus(entry, tools);
    const local = tools.find((t) => t.plugin && t.id === entry.id);
    const working = busy.has(entry.id);
    return (
      <div className="store-card" key={entry.id}>
        <span className="store-icon"><ToolIcon name={entry.icon} size={24} /></span>
        <div className="store-info">
          <div className="store-name">
            {entry.name}
            <span className="muted store-version">
              {status === "update" ? `v${local?.version} → v${entry.version}` : `v${entry.version}`}
            </span>
            {status === "update" && <span className="store-badge">Mise à jour</span>}
          </div>
          {entry.description && <div className="muted">{entry.description}</div>}
          {entry.size ? <div className="muted store-size">{formatSize(entry.size)}</div> : null}
        </div>
        <div className="store-actions">
          {status !== "installed" && (
            <button className="btn-primary" disabled={occupe(entry.id)}
              onClick={() => run(entry.id, () => installPlugin(entry.id))}>
              {working ? "Téléchargement…" : status === "update" ? "Mettre à jour" : "Télécharger"}
            </button>
          )}
          {status !== "absent" && (
            <UninstallButton armed={armed === entry.id} disabled={occupe(entry.id)}
              onArm={() => setArmed(entry.id)} onDisarm={() => setArmed(null)}
              onConfirm={() => { setArmed(null); void run(entry.id, () => uninstallPlugin(entry.id)); }} />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="outil">
      <header className="outil-barre">
        <div className="toolbar-title">
          <h2>Outils</h2>
          <span className="muted">N'installez que ce dont vous avez besoin</span>
        </div>
        <div className="toolbar-actions">
          <button onClick={onRefresh} disabled={loading || !canUseStore}>
            {loading ? "Actualisation…" : "↻ Actualiser"}
          </button>
        </div>
      </header>

      <div className="store-list">
        {!canUseStore && (
          <div className="banner banner-info">
            {isMobile
              ? "Sur téléphone, les outils sont fournis avec l'application : mettez l'APK à jour pour en recevoir de nouveaux."
              : "Le catalogue n'est disponible que dans l'application de bureau ExziHub."}
          </div>
        )}
        {catalogError && (
          <div className="banner banner-alert">Catalogue injoignable : {catalogError}</div>
        )}
        {error && <div className="banner banner-alert">{error}</div>}
        {nouveauHub && (
          <div className="banner banner-info">
            <span>ExziHub v{nouveauHub.version} est disponible (vous avez la v{hubVersion}). {formatSize(nouveauHub.size)}</span>
            <button className="btn-primary" disabled={busy.size > 0} onClick={() => run(HUB, updateHub)}>
              {hubBusy ? "Téléchargement…" : "Mettre à jour et redémarrer"}
            </button>
          </div>
        )}

        {groupByCategory(catalog?.plugins ?? []).map((g) => (
          <CategoryGroup key={g.id} scope="store" id={g.id} label={g.label} className="store-group">
            {g.items.map(carte)}
            {g.subgroups.map((sg) => (
              <CategoryGroup key={sg.id} scope="store" id={sg.id} label={sg.label} className="store-group store-subgroup">
                {sg.items.map(carte)}
              </CategoryGroup>
            ))}
          </CategoryGroup>
        ))}

        {orphans.map((t) => (
          <div className="store-card" key={t.id}>
            <span className="store-icon"><ToolIcon name={t.icon} size={24} /></span>
            <div className="store-info">
              <div className="store-name">{t.name}<span className="muted store-version">v{t.version}</span></div>
              <div className="muted">Installé localement, absent du catalogue</div>
            </div>
            <div className="store-actions">
              <UninstallButton armed={armed === t.id} disabled={occupe(t.id)}
                onArm={() => setArmed(t.id)} onDisarm={() => setArmed(null)}
                onConfirm={() => { setArmed(null); void run(t.id, () => uninstallPlugin(t.id)); }} />
            </div>
          </div>
        ))}

        {catalog && catalog.plugins.length === 0 && orphans.length === 0 && <div className="empty">Le catalogue est vide.</div>}
        {!catalog && !catalogError && canUseStore && <div className="empty">Chargement du catalogue…</div>}
      </div>
    </div>
  );
}

/** Desinstallation en deux clics : le premier arme, le second confirme. */
function UninstallButton({ armed, disabled, onArm, onDisarm, onConfirm }: {
  armed: boolean; disabled: boolean; onArm: () => void; onDisarm: () => void; onConfirm: () => void;
}) {
  return (
    <button className={`btn-remove ${armed ? "is-armed" : ""}`} disabled={disabled}
      onClick={armed ? onConfirm : onArm} onBlur={onDisarm}
      title={armed ? "Cliquez pour confirmer" : "Désinstaller (les données de l'outil sont conservées)"}>
      {armed ? "Confirmer ?" : "Désinstaller"}
    </button>
  );
}
