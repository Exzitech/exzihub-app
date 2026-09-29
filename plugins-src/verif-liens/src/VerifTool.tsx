import { useMemo, useRef, useState } from "react";
import { exportFile, LaunchButton, toast, useToolSocket, type ToolScreenProps } from "../../shared/hub";

interface Dead {
  url: string;
  code: number | null;
  erreur: string | null;
}
interface Progress {
  faits: number;
  total: number;
  vivants: number;
  morts: number;
}
interface Result {
  vivants: string[];
  morts: Dead[];
  total: number;
}
interface Server {
  hote: string;
  nb: number;
  ip: string | null;
}
interface ServerResult {
  serveurs: Server[];
  total: number;
}

type Mode = "liens" | "serveurs";

/**
 * Ne garde que les lignes qui sont des URL (http/https). Les autres lignes sont ignorees :
 * un fichier M3U colle tel quel passe donc directement (ses lignes #EXTM3U / #EXTINF sont
 * jetees, seules ses URL sont testees). NB : on ne classe pas les liens en "M3U ou non",
 * on retient juste ce qui est une URL a tester.
 */
function extractUrls(text: string): string[] {
  const urls: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (/^https?:\/\//i.test(l)) urls.push(l);
  }
  return urls;
}

/** Écran du plugin : saisie des liens, puis deux modes — tester les liens, ou identifier les serveurs. */
export function VerifTool({ tool }: ToolScreenProps) {
  const [mode, setMode] = useState<Mode>("liens");
  const [text, setText] = useState("");
  const [fetchUrl, setFetchUrl] = useState("");
  const [limit, setLimit] = useState(100);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [servers, setServers] = useState<ServerResult | null>(null);
  const [showDead, setShowDead] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { status, send } = useToolSocket(`ws://localhost:${tool.port ?? 8002}/ws`, {
    etat: (m) => setRunning(Boolean(m.occupe)),
    progres: (m) => setProgress(m as unknown as Progress),
    resultat: (m) => {
      setResult(m as unknown as Result);
      setProgress(null);
      setRunning(false);
    },
    serveurs_resultat: (m) => {
      setServers(m as unknown as ServerResult);
      setRunning(false);
    },
    charge: (m) => {
      const contents = String(m.texte ?? "");
      setText((t) => (t ? t + "\n" : "") + contents);
      toast(`Fetched ${extractUrls(contents).length} links`);
    },
    erreur: (m) => {
      toast(String(m.message ?? "Engine error"), "erreur");
      setRunning(false);
    },
  });
  const connected = status === "open";

  // Unique links in order, duplicates removed.
  const urls = useMemo(() => [...new Set(extractUrls(text))], [text]);

  // Demande au moteur d'aller chercher un fichier de liens à une URL (le moteur télécharge, pas le navigateur).
  function fetchFromUrl() {
    const u = fetchUrl.trim();
    if (!connected) {
      toast("Engine not started: click Start.", "erreur");
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      toast("Enter a valid http(s) URL.", "erreur");
      return;
    }
    send({ type: "charger", url: u });
  }

  // Ajoute le contenu d'un fichier à la zone de texte (cumulé, pas remplacé : plusieurs fichiers).
  async function loadFile(file: File) {
    const contents = await file.text();
    setText((t) => (t ? t + "\n" : "") + contents);
    toast(`${file.name} loaded`);
  }

  // Vérifie qu'il y a de quoi travailler avant d'envoyer une commande au moteur.
  function ready(): boolean {
    if (!connected) {
      toast("Engine not started: click Start.", "erreur");
      return false;
    }
    if (urls.length === 0) {
      toast("No links loaded.", "erreur");
      return false;
    }
    return true;
  }

  // Mode Links : teste chaque URL (en ligne / hors ligne).
  function checkLinks() {
    if (!ready()) return;
    setResult(null);
    setProgress({ faits: 0, total: urls.length, vivants: 0, morts: 0 });
    setRunning(true);
    send({ type: "verifier", urls, limite: limit });
  }

  // Mode Servers : identifie les serveurs uniques derrière les liens (hôte, nombre, DNS).
  function identifyServers() {
    if (!ready()) return;
    setServers(null);
    setRunning(true);
    send({ type: "serveurs", urls });
  }

  // Copie les liens en ligne dans le presse-papier, un par ligne.
  function copyAlive() {
    if (!result?.vivants.length) return;
    navigator.clipboard.writeText(result.vivants.join("\n"));
    toast(`${result.vivants.length} links copied`);
  }

  // Écrit les liens en ligne dans un fichier de Téléchargements (le hub confirme lui-même).
  async function saveAlive() {
    if (!result?.vivants.length) return;
    await exportFile("live-links.txt", result.vivants.join("\n") + "\n");
  }

  // Exporte le rapport des serveurs en CSV (hôte, nb de liens, résolution DNS, IP).
  async function exportServers() {
    if (!servers?.serveurs.length) return;
    const lines = ["host,links,resolves,ip"];
    for (const s of servers.serveurs) {
      lines.push(`${s.hote},${s.nb},${s.ip ? "yes" : "no"},${s.ip ?? ""}`);
    }
    await exportFile("servers-report.csv", lines.join("\n") + "\n");
  }

  const pct = progress && progress.total ? Math.round((progress.faits / progress.total) * 100) : 0;

  return (
    <div className="vl">
      <header className="vl-tete">
        <div className="vl-titre">
          <h2>{tool.name}</h2>
          <span className={connected ? "vl-etat vl-ok" : "vl-etat vl-ko"}>
            {connected ? "Engine ready" : "Engine not started"}
          </span>
        </div>
        <LaunchButton tool={tool} />
      </header>

      <div className="vl-modes">
        <button className={mode === "liens" ? "vl-actif" : ""} onClick={() => setMode("liens")}>
          Links
        </button>
        <button className={mode === "serveurs" ? "vl-actif" : ""} onClick={() => setMode("serveurs")}>
          Servers
        </button>
      </div>

      <p className="vl-aide">
        {mode === "liens"
          ? "Paste your links (one per line) or load a .txt file. The engine tests each URL and keeps only the ones that respond."
          : "Extracts the unique servers behind the links (host, number of links, DNS resolution). Passive: it queries DNS, it does not connect to the services."}{" "}
        Lines that are not links (e.g. an M3U file) are ignored.
      </p>

      <div className="vl-fetch">
        <input
          type="url"
          value={fetchUrl}
          onChange={(e) => setFetchUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchFromUrl()}
          placeholder="https://…  (fetch an M3U / link list from a URL)"
          disabled={running}
        />
        <button onClick={fetchFromUrl} disabled={running || !fetchUrl.trim()}>
          Fetch
        </button>
      </div>

      <div
        className="vl-depot"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) loadFile(f);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://example.com&#10;https://other.com/page"
          spellCheck={false}
          disabled={running}
        />
      </div>

      <div className="vl-barre-actions">
        <button onClick={() => fileRef.current?.click()} disabled={running}>
          Load a file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.m3u,.m3u8,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = "";
          }}
        />
        <button onClick={() => setText("")} disabled={running || !text}>
          Clear
        </button>
        {mode === "liens" && (
          <label className="vl-limite">
            Parallel requests
            <input
              type="number"
              min={1}
              max={1000}
              value={limit}
              disabled={running}
              onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            />
          </label>
        )}
        <span className="vl-compte">{urls.length} link{urls.length > 1 ? "s" : ""}</span>
        {running ? (
          <button className="vl-primaire" onClick={() => send({ type: "annuler" })}>
            Cancel
          </button>
        ) : mode === "liens" ? (
          <button className="vl-primaire" onClick={checkLinks} disabled={!connected || urls.length === 0}>
            Check
          </button>
        ) : (
          <button className="vl-primaire" onClick={identifyServers} disabled={!connected || urls.length === 0}>
            Identify servers
          </button>
        )}
      </div>

      {progress && mode === "liens" && (
        <div className="vl-progres">
          <div className="vl-jauge">
            <div className="vl-jauge-plein" style={{ width: `${pct}%` }} />
          </div>
          <span>
            {progress.faits} / {progress.total} — {progress.vivants} online, {progress.morts} offline
          </span>
        </div>
      )}

      {mode === "liens" && result && (
        <div className="vl-resultat">
          <div className="vl-bilan">
            <strong>
              {result.vivants.length} / {result.total}
            </strong>{" "}
            online
            <div className="vl-boutons">
              <button onClick={copyAlive} disabled={!result.vivants.length}>
                Copy live links
              </button>
              <button onClick={saveAlive} disabled={!result.vivants.length}>
                Save live links
              </button>
            </div>
          </div>

          <div className="vl-onglets">
            <button className={showDead ? "" : "vl-actif"} onClick={() => setShowDead(false)}>
              Online ({result.vivants.length})
            </button>
            <button className={showDead ? "vl-actif" : ""} onClick={() => setShowDead(true)}>
              Offline ({result.morts.length})
            </button>
          </div>

          <ul className="vl-liste">
            {showDead
              ? result.morts.map((m) => (
                  <li key={m.url}>
                    <span className="vl-url">{m.url}</span>
                    <span className="vl-detail">{m.code ?? m.erreur ?? "—"}</span>
                  </li>
                ))
              : result.vivants.map((u) => (
                  <li key={u}>
                    <span className="vl-url">{u}</span>
                  </li>
                ))}
          </ul>
        </div>
      )}

      {mode === "serveurs" && servers && (
        <div className="vl-resultat">
          <div className="vl-bilan">
            <strong>{servers.serveurs.length}</strong> unique servers ({servers.total} links)
            <div className="vl-boutons">
              <button onClick={exportServers} disabled={!servers.serveurs.length}>
                Export report (CSV)
              </button>
            </div>
          </div>

          <ul className="vl-liste vl-serveurs">
            <li className="vl-entete">
              <span className="vl-url">Host</span>
              <span className="vl-col">Links</span>
              <span className="vl-col">DNS</span>
            </li>
            {servers.serveurs.map((s) => (
              <li key={s.hote}>
                <span className="vl-url">{s.hote}</span>
                <span className="vl-col">{s.nb}</span>
                <span className="vl-col">{s.ip ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
