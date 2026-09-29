/**
 * Confirmation breve en bas de l'ecran. Hors React, volontairement : la meme
 * fonction sert a la fenetre principale, aux fenetres flottantes et aux
 * plugins, sans avoir a brancher un contexte dans chacun de ces arbres.
 */
const DUREE = { ok: 5000, erreur: 9000 } as const;

let zone: HTMLDivElement | null = null;

/** Affiche un message passager ; un clic le fait partir tout de suite. */
export function toast(texte: string, type: keyof typeof DUREE = "ok"): void {
  if (!zone || !zone.isConnected) {
    zone = document.createElement("div");
    zone.className = "toasts";
    // Lu par les lecteurs d'ecran sans voler le focus.
    zone.setAttribute("role", "status");
    zone.setAttribute("aria-live", "polite");
    document.body.appendChild(zone);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = texte;
  const partir = () => el.remove();
  el.addEventListener("click", partir);
  setTimeout(partir, DUREE[type]);
  zone.appendChild(el);
}
