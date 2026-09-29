import type { MouseEvent } from "react";
import { useToolProcess } from "../hooks/useToolProcess";
import type { ToolConfig } from "../registry";

export function LaunchButton({ tool, compact = false }: { tool: ToolConfig; compact?: boolean }) {
  const { available, running, busy, error, toggle } = useToolProcess(tool);
  if (!available) return null;

  const onClick = (e: MouseEvent) => {
    // Le bouton peut etre pose dans un lien ou un formulaire (plugins) : ne rien declencher d'autre.
    e.preventDefault();
    e.stopPropagation();
    toggle();
  };

  const label = running ? "Arrêter le backend" : "Lancer le backend";
  return (
    <span className="launch">
      <button
        className={`btn-launch ${running ? "is-running" : ""} ${compact ? "compact" : ""}`}
        onClick={onClick}
        disabled={busy}
        title={error ?? label}
      >
        {running ? "■" : "▶"}{!compact && ` ${label}`}
      </button>
      {error && !compact && <span className="launch-error">{error}</span>}
    </span>
  );
}
