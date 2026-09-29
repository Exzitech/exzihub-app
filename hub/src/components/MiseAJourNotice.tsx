import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ToolConfig } from "../registry";
import { hubUpdate, pluginStatus, type Catalog } from "../store";

interface Props {
  catalog: Catalog | null;
  tools: ToolConfig[];
  hubVersion: string | null;
}

/**
 * Bandeau des mises a jour disponibles (hub et plugins), sur toutes les pages sauf Outils
 * qui les detaille deja. « Plus tard » ne le masque que jusqu'au prochain lancement, et
 * reparait si une version encore plus recente est publiee : une mise a jour ne doit pas
 * etre oubliee, contrairement au bandeau de migration, propose une seule fois.
 */
export function MiseAJourNotice({ catalog, tools, hubVersion }: Props) {
  const [masque, setMasque] = useState<string | null>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const nouveautes: string[] = [];
  const hub = hubUpdate(catalog, hubVersion);
  if (hub) nouveautes.push(`ExziHub ${hub.version}`);
  for (const entree of catalog?.plugins ?? []) {
    if (pluginStatus(entree, tools) === "update") nouveautes.push(`${entree.name} ${entree.version}`);
  }

  const signature = nouveautes.join("|");
  if (nouveautes.length === 0 || signature === masque || pathname === "/outils") return null;

  return (
    <div className="banner banner-info">
      <span>
        <strong>{nouveautes.length > 1 ? "Mises à jour disponibles" : "Mise à jour disponible"}</strong>
        {" : "}
        {nouveautes.join(", ")}
      </span>
      <span className="migration-actions">
        <button className="btn-primary" onClick={() => navigate("/outils")}>Voir</button>
        <button onClick={() => setMasque(signature)}>Plus tard</button>
      </span>
    </div>
  );
}
