import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const key = (scope: string, id: string) => `exzihub.collapsed.${scope}.${id}`;

/** Groupe repliable ; l'etat est retenu par ecran (`scope`) et par categorie. */
export function CategoryGroup({ scope, id, label, className, children }: {
  scope: string; id: string; label: string; className: string; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key(scope, id)) === "1"; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem(key(scope, id), collapsed ? "0" : "1"); } catch { /* stockage indisponible : etat non retenu */ }
  };
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div className={`cat-group ${collapsed ? "is-collapsed" : ""}`} data-cat={id}>
      <button type="button" className={className} onClick={toggle} aria-expanded={!collapsed}>
        <Chevron size={14} /><span>{label}</span>
      </button>
      <div className="cat-body">{children}</div>
    </div>
  );
}
