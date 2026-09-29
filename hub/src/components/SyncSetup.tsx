import { useCallback, useEffect, useState } from "react";
import { sync, type Espace, type SyncEtat } from "../sync";

interface Props {
  /** Id du plugin : chaque plugin a son propre espace. */
  id: string;
  /** Dossier propose dans le compte, ex. "ExziHub/Budget". */
  dossierParDefaut: string;
  /** Autorise un lien de partage (espace commun avec quelqu'un d'autre). */
  lien?: boolean;
  /** Appele une fois l'espace enregistre. */
  onChange?: () => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Connexion Nextcloud et choix de l'espace d'un plugin (dossier du compte ou lien de partage). */
export function SyncSetup({ id, dossierParDefaut, lien = false, onChange }: Props) {
  const [etat, setEtat] = useState<SyncEtat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<"connexion" | "enregistrement" | null>(null);
  const [serveur, setServeur] = useState("https://");
  const [mode, setMode] = useState<Espace["mode"]>("compte");
  const [dossier, setDossier] = useState(dossierParDefaut);
  const [adresseLien, setAdresseLien] = useState("");
  const [motDePasse, setMotDePasse] = useState("");

  const relire = useCallback(async () => {
    try {
      const e = await sync.etat(id);
      setEtat(e);
      if (e.espace?.mode === "compte") { setMode("compte"); setDossier(e.espace.dossier); }
      if (e.espace?.mode === "lien") { setMode("lien"); setAdresseLien(e.espace.lien); }
    } catch (e) {
      setErreur(message(e));
    }
  }, [id]);

  useEffect(() => { void relire(); }, [relire]);

  const agir = async (quoi: "connexion" | "enregistrement", action: () => Promise<unknown>) => {
    setOccupe(quoi);
    setErreur(null);
    try {
      await action();
      await relire();
      return true;
    } catch (e) {
      setErreur(message(e));
      return false;
    } finally {
      setOccupe(null);
    }
  };

  const enregistrer = async () => {
    const espace: Espace = mode === "compte" ? { mode, dossier } : { mode, lien: adresseLien, motDePasse };
    if (await agir("enregistrement", () => sync.choisir(id, espace))) onChange?.();
  };

  if (!etat) return <div className="sync-setup">{erreur && <p className="sync-error">{erreur}</p>}</div>;

  return (
    <div className="sync-setup">
      <h4>Compte Nextcloud</h4>
      {etat.compte ? (
        <p>
          Connecté en tant que <strong>{etat.compte}</strong>{" "}
          <button onClick={() => agir("connexion", sync.deconnecter)} disabled={occupe !== null}>Se déconnecter</button>
        </p>
      ) : occupe === "connexion" ? (
        <p>
          Connectez-vous sur la page Nextcloud qui vient de s'ouvrir dans votre navigateur…{" "}
          <button onClick={() => void sync.annulerConnexion()}>Annuler</button>
        </p>
      ) : (
        <p className="sync-row">
          <input value={serveur} onChange={(e) => setServeur(e.target.value)} placeholder="https://cloud.example.com" />
          <button className="btn-primary" onClick={() => agir("connexion", () => sync.connecter(serveur))}>Se connecter</button>
        </p>
      )}

      <h4>Où ranger les données de cet outil</h4>
      {lien && (
        <p className="sync-row">
          <label><input type="radio" checked={mode === "compte"} onChange={() => setMode("compte")} /> Un dossier de mon compte</label>
          <label><input type="radio" checked={mode === "lien"} onChange={() => setMode("lien")} /> Un lien de partage</label>
        </p>
      )}
      {mode === "compte" ? (
        <p className="sync-row">
          <input value={dossier} onChange={(e) => setDossier(e.target.value)} placeholder="Dossier, ex. ExziHub/Budget" />
        </p>
      ) : (
        <p className="sync-row">
          <input value={adresseLien} onChange={(e) => setAdresseLien(e.target.value)} placeholder="https://cloud.example.com/s/…" />
          <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder="Mot de passe du partage (s'il y en a)" />
        </p>
      )}
      <p>
        <button className="btn-primary" onClick={enregistrer}
          disabled={occupe !== null || (mode === "compte" && !etat.compte)}>
          {occupe === "enregistrement" ? "Vérification…" : "Enregistrer"}
        </button>
        {etat.espace && <span className="muted"> Actuel : {etat.espace.mode === "compte" ? etat.espace.dossier : etat.espace.lien}</span>}
      </p>
      {erreur && <p className="sync-error">{erreur}</p>}
    </div>
  );
}
