import { useEffect, useState } from "react";

export type Health = "unknown" | "up" | "down";

const INTERVAL_MS = 4000;
const TIMEOUT_MS = 2000;

/**
 * Ping periodique de http://localhost:{port}/health.
 *
 * `mode: "no-cors"` : le backend n'a pas a exposer d'en-tetes CORS. La reponse
 * est opaque (statut illisible) mais la promesse ne se resout que si le serveur
 * a repondu ; un refus de connexion la rejette. C'est exactement le signal
 * "le backend est lance" dont la sidebar a besoin.
 */
export function useHealth(port: number): Health {
  const [health, setHealth] = useState<Health>("unknown");

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const ping = async () => {
      const controller = new AbortController();
      const abort = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
      let ok = false;
      try {
        await fetch(`http://localhost:${port}/health`, {
          mode: "no-cors",
          cache: "no-store",
          signal: controller.signal,
        });
        ok = true;
      } catch {
        ok = false;
      } finally {
        window.clearTimeout(abort);
      }
      if (disposed) return;
      setHealth(ok ? "up" : "down");
      timer = window.setTimeout(ping, INTERVAL_MS);
    };

    ping();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [port]);

  return health;
}
