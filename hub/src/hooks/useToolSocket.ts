import { useCallback, useEffect, useRef, useState } from "react";

export type SocketStatus = "connecting" | "open" | "closed";

/** Un message backend : seul `type` est garanti, le reste depend du type. */
export interface ToolMessage {
  type: string;
  [key: string]: unknown;
}

export type MessageHandlers = Record<string, (msg: ToolMessage) => void>;

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 3000;

/**
 * WebSocket d'un outil, vivant uniquement tant que le composant est monte.
 *
 * - Chaque message JSON est route vers `handlers[msg.type]`.
 * - Type inconnu, JSON invalide ou message sans `type` : ignore sans bruit,
 *   pour que le backend puisse ajouter des types sans casser le hub.
 * - Reconnexion automatique (backoff plafonne) si le backend tombe ou redemarre.
 * - Demontage (on quitte la route) : fermeture propre, aucune reconnexion.
 */
export function useToolSocket(url: string, handlers: MessageHandlers) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  // Les handlers changent a chaque rendu : on lit toujours la derniere version
  // sans relancer la connexion.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
      };

      ws.onmessage = (event) => {
        let msg: ToolMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== "string") return;
        const handler = handlersRef.current[msg.type];
        if (!handler) return;
        try {
          handler(msg);
        } catch (err) {
          // Un payload inattendu ne doit pas faire tomber l'ecran.
          console.error(`Handler "${msg.type}" en erreur :`, err, msg);
        }
      };

      // onerror est toujours suivi de onclose : tout se gere la-bas.
      ws.onclose = () => {
        if (socketRef.current === ws) socketRef.current = null;
        if (disposed) return;
        setStatus("closed");
        const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt++);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = null;
        ws.close(1000, "route quittee");
      }
    };
  }, [url]);

  /** Envoie une commande JSON ; false si le socket n'est pas ouvert. */
  const send = useCallback((payload: object): boolean => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  return { status, send };
}
