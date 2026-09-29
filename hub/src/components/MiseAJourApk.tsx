import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/**
 * Telephone : propose la version de l'APK publiee dans le catalogue (maj_apk.rs), verifiee
 * au lancement. Installer ouvre l'installeur d'Android, qui demande confirmation.
 * Sans reseau, la verification echoue sans rien afficher : elle sera refaite au prochain lancement.
 */
export function MiseAJourApk() {
  const [version, setVersion] = useState<string | null>(null);
  const [etat, setEtat] = useState<"attente" | "telechargement" | "erreur">("attente");
  const [erreur, setErreur] = useState<string | null>(null);
  const [progression, setProgression] = useState<{ recu: number; total: number | null } | null>(null);

  useEffect(() => {
    invoke<{ version: string } | null>("apk_verifier")
      .then((d) => setVersion(d?.version ?? null))
      .catch((e) => console.warn("Verification de mise a jour impossible :", e));
  }, []);

  useEffect(() => {
    const arret = listen<{ recu: number; total: number | null }>("maj-apk", (e) => setProgression(e.payload));
    return () => { void arret.then((f) => f()); };
  }, []);

  if (!version) return null;
  const mo = (n: number) => (n / 1024 / 1024).toFixed(1);
  const avancement = !progression ? "" : progression.total
    ? ` ${Math.round((progression.recu * 100) / progression.total)} % (${mo(progression.recu)} / ${mo(progression.total)} MB)`
    : ` ${mo(progression.recu)} MB`;
  const installer = async () => {
    setEtat("telechargement");
    setProgression(null);
    try {
      await invoke("apk_installer");
      setEtat("attente");
    } catch (e) {
      setErreur(String(e));
      setEtat("erreur");
    }
  };
  return (
    <div className={`banner ${etat === "erreur" ? "banner-alert" : "banner-info"}`}>
      <span>{etat === "erreur" ? `Échec de la mise à jour : ${erreur}` : `ExziHub v${version} est disponible.`}</span>
      <button className="btn-primary" disabled={etat === "telechargement"} onClick={installer}>
        {etat === "telechargement" ? `Téléchargement…${avancement}` : etat === "erreur" ? "Réessayer" : "Installer"}
      </button>
    </div>
  );
}
