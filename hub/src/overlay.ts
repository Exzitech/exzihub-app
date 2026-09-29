import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useEffect, type RefObject } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ToolConfig } from "./registry";
import { isMobile } from "./platform";

/**
 * Fenetres flottantes d'outil : sans cadre, sombres, toujours au-dessus du jeu.
 *
 * Elles chargent la meme page que le hub ; c'est le libelle de la fenetre
 * (`overlay-<id>` ou `overlay-<id>:<vue>`) qui dit quoi afficher. Un outil peut
 * ainsi avoir plusieurs fenetres flottantes, une par vue. Pas d'URL a construire, donc rien
 * qui differe entre le mode dev et l'executable.
 */
const PREFIX = "overlay-";
const VIEW_SEPARATOR = ":";
const inTauri = "__TAURI_INTERNALS__" in window;

interface Geometry { x: number; y: number; width: number; height: number }

const storageKey = (toolId: string) => `overlay-geometry:${toolId}`;

function loadGeometry(toolId: string): Geometry | null {
  try {
    const raw = localStorage.getItem(storageKey(toolId));
    return raw ? (JSON.parse(raw) as Geometry) : null;
  } catch {
    return null;
  }
}

/** Outil et vue de la fenetre courante si c'est un overlay, sinon null. */
export function currentOverlay(): { toolId: string; view: string } | null {
  if (!inTauri) return null;
  const label = getCurrentWindow().label;
  if (!label.startsWith(PREFIX)) return null;
  const [toolId, view = ""] = label.slice(PREFIX.length).split(VIEW_SEPARATOR);
  return { toolId, view };
}

/** Cle de fenetre : l'outil, et la vue s'il y en a une. */
export const overlayKey = (toolId: string, view = "") =>
  view ? toolId + VIEW_SEPARATOR + view : toolId;

export const canOpenOverlay = inTauri && !isMobile;

/** Ouvre une fenetre flottante de l'outil, ou la ramene devant si deja ouverte. */
export async function openOverlay(tool: ToolConfig, view = "", title = "liste d'achats"): Promise<void> {
  const key = overlayKey(tool.id, view);
  const label = PREFIX + key;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.unminimize();
    await existing.setFocus();
    return;
  }
  const geometry = loadGeometry(key);
  const overlay = new WebviewWindow(label, {
    url: "index.html",
    title: title ? `${tool.name} — ${title}` : tool.name,
    width: geometry?.width ?? 440,
    height: geometry?.height ?? 520,
    ...(geometry ? { x: geometry.x, y: geometry.y } : { center: true }),
    minWidth: 300,
    minHeight: 140,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    // Visible dans les partages d'ecran (Discord...). Attention a ne pas la
    // laisser SUR la zone de capture OCR (chat ou coordonnees) : elle serait
    // alors relue par l'OCR, comme n'importe quelle autre fenetre a cet
    // endroit - simple question de positionnement, pas de protection requise.
    resizable: true,
  });
  overlay.once("tauri://error", (e) => console.error("Overlay impossible :", e.payload));
}

const MIN_HEIGHT = 60;
const MAX_SCREEN_RATIO = 0.85;

/**
 * Ajuste la hauteur de la fenetre flottante a son contenu (la largeur reste
 * celle choisie a la souris). Au-dela de 85 % de l'ecran, la liste defile.
 *
 * `frame` : la fenetre entiere ; `content` : ce qui doit etre visible en entier
 * (dans un conteneur qui defile). Hauteur voulue = cadre sans le conteneur
 * defilant + hauteur naturelle du contenu.
 */
export function useAutoHeight(frame: RefObject<HTMLElement>, scroller: RefObject<HTMLElement>,
  content: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!inTauri || !frame.current || !scroller.current || !content.current) return;
    const win = getCurrentWindow();
    let raf = 0;
    let last = 0;

    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(async () => {
        const f = frame.current, s = scroller.current, c = content.current;
        if (!f || !s || !c) return;
        const style = getComputedStyle(s);
        const chrome = f.offsetHeight - s.clientHeight; // barre, alerte, bordures
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const max = Math.floor(window.screen.availHeight * MAX_SCREEN_RATIO);
        const wanted = Math.max(MIN_HEIGHT, Math.min(max, Math.ceil(chrome + padding + c.offsetHeight)));
        if (Math.abs(wanted - last) < 2 && Math.abs(wanted - window.innerHeight) < 2) return;
        last = wanted;
        try {
          const scale = await win.scaleFactor();
          const width = (await win.innerSize()).toLogical(scale).width;
          await win.setSize(new LogicalSize(width, wanted));
        } catch (err) {
          console.error("Redimensionnement impossible :", err);
        }
      });
    };

    const observer = new ResizeObserver(fit);
    observer.observe(content.current);
    observer.observe(frame.current); // largeur changee a la souris : les lignes rewrappent
    fit();
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [frame, scroller, content]);
}

/** Memorise position et taille de l'overlay courant pour la prochaine ouverture. */
export async function rememberOverlayGeometry(key: string): Promise<() => void> {
  const win = getCurrentWindow();
  let timer: number | undefined;
  const save = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        const scale = await win.scaleFactor();
        const pos = (await win.outerPosition()).toLogical(scale);
        const size = (await win.innerSize()).toLogical(scale);
        const geometry: Geometry = { x: pos.x, y: pos.y, width: size.width, height: size.height };
        localStorage.setItem(storageKey(key), JSON.stringify(geometry));
      } catch {
        /* fenetre en cours de fermeture */
      }
    }, 300);
  };
  const offMove = await win.onMoved(save);
  const offResize = await win.onResized(save);
  return () => { offMove(); offResize(); window.clearTimeout(timer); };
}

