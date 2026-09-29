import { NavLink } from "react-router-dom";
import { useHealth } from "../hooks/useHealth";
import type { ToolConfig } from "../registry";
import { groupByCategory } from "../categories";
import { ToolIcon } from "../icons";
import { isMobile } from "../platform";
import { CategoryGroup } from "./CategoryGroup";
import { LaunchButton } from "./LaunchButton";

const HEALTH_LABEL = {
  unknown: "Vérification…",
  up: "Backend en ligne",
  down: "Backend non lancé",
} as const;

function HealthDot({ port }: { port: number }) {
  const health = useHealth(port);
  const label = `${HEALTH_LABEL[health]} (port ${port})`;
  // role + aria-label : la forme et la couleur seules ne suffisent pas.
  return <span className={`health-dot health-${health}`} role="img" aria-label={label} title={label} />;
}

function SidebarItem({ tool, onNavigate }: { tool: ToolConfig; onNavigate?: () => void }) {
  return (
    // Le bouton de lancement est frere du lien, pas dedans : cible propre, pas
    // de clic qui navigue par erreur, et il reste utilisable au clavier.
    <div className="sidebar-row">
      <NavLink to={`/${tool.id}`} className="sidebar-item" title={tool.name} onClick={onNavigate}>
        <span className="sidebar-icon"><ToolIcon name={tool.icon} /></span>
        <span className="sidebar-name">{tool.name}</span>
        {tool.port !== undefined && <HealthDot port={tool.port} />}
      </NavLink>
      <LaunchButton tool={tool} compact />
    </div>
  );
}

export function Sidebar({ tools, updateCount, ouvert, onNavigate }: {
  tools: ToolConfig[]; updateCount: number; ouvert?: boolean; onNavigate?: () => void;
}) {
  return (
    // `ouvert` ne sert qu'au tiroir du telephone ; sur PC la sidebar est toujours la.
    <nav className={`sidebar ${ouvert ? "is-open" : ""}`} aria-label="Outils installés">
      <div className="sidebar-title">ExziHub</div>
      {groupByCategory(tools).map((g) => (
        <CategoryGroup key={g.id} scope="sidebar" id={g.id} label={g.label} className="sidebar-group">
          {g.items.map((tool) => <SidebarItem key={tool.id} tool={tool} onNavigate={onNavigate} />)}
          {g.subgroups.map((s) => (
            <CategoryGroup key={s.id} scope="sidebar" id={s.id} label={s.label} className="sidebar-group sidebar-subgroup">
              {s.items.map((tool) => <SidebarItem key={tool.id} tool={tool} onNavigate={onNavigate} />)}
            </CategoryGroup>
          ))}
        </CategoryGroup>
      ))}
      {tools.length === 0 && (
        <div className="sidebar-empty">
          Aucun outil installé.{!isMobile && <> Ouvrez <strong>Outils</strong> ci-dessous pour en ajouter.</>}
        </div>
      )}
      {/* Telephone : plugins embarques dans l'APK, pas de catalogue. */}
      {!isMobile && (
        <NavLink to="/outils" className="sidebar-item sidebar-store" title="Outils" onClick={onNavigate}>
          <span className="sidebar-icon"><ToolIcon name="toolbox" /></span>
          <span className="sidebar-name">Outils</span>
          {updateCount > 0 && <span className="store-badge" title="Mises à jour disponibles">{updateCount}</span>}
        </NavLink>
      )}
    </nav>
  );
}
