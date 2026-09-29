import { estFaite, type Tache } from "./store";

const LABEL = { jour: "daily", semaine: "weekly", manuel: "manual" } as const;

export function ListeTaches({ taches, maintenant, basculer, supprimer }: {
  taches: Tache[];
  maintenant: Date;
  basculer: (id: string) => void;
  supprimer?: (id: string) => void;
}) {
  if (taches.length === 0) return <p className="hint">No tasks yet.</p>;
  return (
    <ul className="chk-liste">
      {taches.map((t) => {
        const faite = estFaite(t, maintenant);
        return (
          <li key={t.id} className={faite ? "chk-faite" : ""}>
            <label>
              <input type="checkbox" checked={faite} onChange={() => basculer(t.id)} />
              <span className="chk-nom">{t.nom}</span>
              <span className="chk-periode">{LABEL[t.periode]}</span>
            </label>
            {supprimer && <button className="btn-ghost" onClick={() => supprimer(t.id)} title="Delete">✕</button>}
          </li>
        );
      })}
    </ul>
  );
}
