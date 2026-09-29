import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { ToolConfig } from "../registry";

const POLL_MS = 2000;
const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * Lancer / arreter le backend d'un outil (champ "launch" de tools.json).
 * `running` ne concerne que ce que le hub a lance lui-meme : un script demarre
 * a la main n'apparait pas ici (le voyant de sante, lui, le voit).
 */
export function useToolProcess(tool: ToolConfig) {
  const available = inTauri && !!tool.launch;
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!available) return;
    try {
      setRunning(await invoke<boolean>("tool_running", { id: tool.id }));
    } catch {
      /* hub en cours de fermeture */
    }
  }, [available, tool.id]);

  useEffect(() => {
    refresh();
    if (!available) return;
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [available, refresh]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke(running ? "stop_tool" : "start_tool", { id: tool.id });
    } catch (err) {
      setError(String(err));
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [running, tool.id, refresh]);

  return { available, running, busy, error, toggle };
}
