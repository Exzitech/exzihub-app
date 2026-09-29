import { useState } from "react";
import { ignorerMigration, type Migration } from "../migration";
import { installPlugin } from "../store";

interface Props {
  migration: Migration;
  /** Relit les plugins installes une fois l'installation terminee. */
  onInstalled: () => Promise<void>;
  /** Retire le bandeau, que l'outil ait ete installe ou ecarte. */
  onDismiss: () => void;
}

/**
 * Bandeau propose une seule fois par outil devenu plugin : sans lui, l'outil
 * a simplement disparu de la barre laterale apres une mise a jour.
 */
export function MigrationNotice({ migration, onInstalled, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await installPlugin(migration.id);
      await onInstalled();
      onDismiss();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Definitif : reproposer a chaque lancement serait du harcelement, et
  // l'ecran Outils reste la pour l'installer plus tard.
  const dismiss = () => {
    ignorerMigration(migration.id);
    onDismiss();
  };

  return (
    <div className="migration-notice">
      <span className="migration-text">
        <strong>{migration.name}</strong> est devenu un plugin. Installez-le pour le retrouver,
        avec vos données.
      </span>
      {error && <span className="migration-error">{error}</span>}
      <span className="migration-actions">
        <button className="btn-primary" onClick={install} disabled={busy}>
          {busy ? "Installation…" : "Installer"}
        </button>
        <button className="btn-ghost" onClick={dismiss} disabled={busy}
          title="Masquer ce bandeau. L'outil reste installable depuis l'écran Outils.">Masquer</button>
      </span>
    </div>
  );
}
