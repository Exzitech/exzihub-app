import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { isMobile } from "../platform";

const inTauri = "__TAURI_INTERNALS__" in window;

/** Garde le hub au-dessus des autres fenetres (equivalent du "topmost" de l'ancienne UI). */
export function PinButton() {
  const [pinned, setPinned] = useState(false);
  if (!inTauri || isMobile) return null;

  const toggle = async () => {
    try {
      await getCurrentWindow().setAlwaysOnTop(!pinned);
      setPinned(!pinned);
    } catch (err) {
      console.error("Always-on-top indisponible :", err);
    }
  };

  return (
    <button className={pinned ? "is-pinned" : ""} onClick={toggle}
      title={pinned ? "Ne plus garder cette fenêtre au-dessus" : "Garder cette fenêtre au-dessus des autres"}>
      📌
    </button>
  );
}
