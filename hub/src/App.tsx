import { useCallback, useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { HashRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { MigrationNotice } from "./components/MigrationNotice";
import { MiseAJourApk } from "./components/MiseAJourApk";
import { MiseAJourNotice } from "./components/MiseAJourNotice";
import { Sidebar } from "./components/Sidebar";
import { StoreScreen } from "./components/StoreScreen";
import { migrationsEnAttente } from "./migration";
import { isMobile } from "./platform";
import { currentOverlay, openOverlay } from "./overlay";
import { loadTools, type ToolConfig } from "./registry";
import { pluginOverlays, pluginScreens } from "./plugins";
import { canUseStore, countUpdates, fetchCatalog, hubUpdate, hubVersion, type Catalog } from "./store";
import { toolOverlays, toolScreens } from "./tools";

const overlay = currentOverlay();
const overlayToolId = overlay?.toolId ?? null;
function OverlayWindow({ tools }: { tools: ToolConfig[] }) {
  const tool = tools.find((t) => t.id === overlayToolId);
  const Overlay = tool && (toolOverlays[tool.id] ?? pluginOverlays[tool.id]);
  if (!tool || !Overlay) return <div className="placeholder">Pas de fenêtre flottante pour « {overlayToolId} »</div>;
  return <Overlay tool={tool} view={overlay?.view} />;
}

function ToolRoute({ tools }: { tools: ToolConfig[] }) {
  const { id } = useParams();
  const tool = tools.find((t) => t.id === id);
  if (!tool) return <div className="placeholder">Outil inconnu : {id}</div>;
  const Screen = toolScreens[tool.id] ?? pluginScreens[tool.id];
  if (!Screen) {
    return <div className="placeholder">Aucun écran pour « {tool.id} »</div>;
  }
  // key : changer d'outil demonte l'ecran precedent, donc ferme son WebSocket.
  return <Screen key={tool.id} tool={tool} />;
}

export function App() {
  const [tools, setTools] = useState<ToolConfig[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Outils devenus plugins et absents apres une mise a jour (voir migration.ts).
  const [migrationsEcartees, setMigrationsEcartees] = useState<string[]>([]);
  // Telephone : la sidebar devient un tiroir, sinon elle mange la moitie de l'ecran.
  const [menuOuvert, setMenuOuvert] = useState(false);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      setCatalog(await fetchCatalog());
      setCatalogError(null);
    } catch (err) {
      setCatalogError(String(err));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  /** Relit tools.json et les plugins installes (apres installation ou desinstallation). */
  const reloadTools = useCallback(async () => setTools(await loadTools()), []);

  useEffect(() => {
    loadTools().then((loaded) => {
      setTools(loaded);
      // Fenetre principale seulement : les fenetres flottantes chargent aussi cette page.
      if (overlayToolId) return;
      loaded.filter((t) => t.autoOverlay).forEach((t) => openOverlay(t, "", ""));
      if (canUseStore) {
        void refreshCatalog();
        void hubVersion().then(setVersion);
      }
    });
  }, [refreshCatalog]);

  useEffect(() => {
    // Fond transparent : c'est la fenetre flottante elle-meme qui peint le sien.
    document.documentElement.classList.toggle("is-overlay", overlayToolId !== null);
  }, []);

  if (tools === null) return overlayToolId ? null : <div className="placeholder">Chargement…</div>;
  if (overlayToolId) return <OverlayWindow tools={tools} />;

  const migrations = migrationsEnAttente(tools, catalog?.plugins.map((e) => e.id) ?? [])
    .filter((m) => !migrationsEcartees.includes(m.id));

  return (
    // HashRouter : pas de dependance a un serveur qui connaitrait les routes.
    <HashRouter>
      <div className={`layout ${isMobile ? "is-mobile" : ""}`}>
        <Sidebar tools={tools} ouvert={menuOuvert} onNavigate={() => setMenuOuvert(false)}
          updateCount={(catalog ? countUpdates(catalog.plugins, tools) : 0) + (hubUpdate(catalog, version) ? 1 : 0)} />
        {/* Voile : fermer le tiroir en touchant a cote, pas seulement par le bouton. */}
        {isMobile && menuOuvert && <div className="drawer-voile" onClick={() => setMenuOuvert(false)} />}
        <main className="content">
          {isMobile && (
            <div className="topbar">
              <button type="button" className="btn-ghost topbar-menu" aria-label="Ouvrir le menu"
                aria-expanded={menuOuvert} onClick={() => setMenuOuvert((o) => !o)}>
                <Menu size={22} />
              </button>
              <span className="topbar-titre">ExziHub</span>
            </div>
          )}
          {isMobile && <MiseAJourApk />}
          <MiseAJourNotice catalog={catalog} tools={tools} hubVersion={version} />
          {migrations.map((m) => (
            <MigrationNotice key={m.id} migration={m} onInstalled={reloadTools}
              onDismiss={() => setMigrationsEcartees((liste) => [...liste, m.id])} />
          ))}
          <Routes>
            <Route
              path="/outils"
              element={<StoreScreen tools={tools} catalog={catalog} hubVersion={version} catalogError={catalogError}
                loading={catalogLoading} onRefresh={refreshCatalog} onChanged={reloadTools} />}
            />
            <Route path="/:id" element={<ToolRoute tools={tools} />} />
            <Route
              path="*"
              element={tools.length
                ? <Navigate to={`/${tools[0].id}`} replace />
                : <Navigate to="/outils" replace />}
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
