import { CalendarSearch, ChartSpline, FilePenLine, GalleryHorizontal, Hammer, Images, type LucideIcon, LandPlot, LayoutGrid, ListChecks, NotebookPen, Puzzle, Route, Server, Smartphone, StickyNote, Toolbox, WalletCards } from "lucide-react";

/**
 * Icones nommees, referencees par le champ `icon` des manifests (ex. "wallet-cards").
 * Imports statiques : seules les icones listees ici entrent dans le bundle.
 * Un emoji est affiche tel quel ; un nom inconnu (hub plus ancien que le plugin) donne une icone neutre.
 */
const ICONS: Record<string, LucideIcon> = {
  "calendar-search": CalendarSearch,
  "chart-spline": ChartSpline,
  "file-pen-line": FilePenLine,
  "gallery-horizontal": GalleryHorizontal,
  images: Images,
  smartphone: Smartphone,
  server: Server,
  hammer: Hammer,
  "layout-grid": LayoutGrid,
  "land-plot": LandPlot,
  "list-checks": ListChecks,
  "notebook-pen": NotebookPen,
  route: Route,
  "sticky-note": StickyNote,
  toolbox: Toolbox,
  "wallet-cards": WalletCards,
};

export function ToolIcon({ name, size = 20 }: { name?: string; size?: number }) {
  if (!name) return <Puzzle size={size} />;
  const Icon = ICONS[name];
  if (Icon) return <Icon size={size} />;
  return /^[a-z0-9-]+$/.test(name) ? <Puzzle size={size} /> : <>{name}</>;
}
