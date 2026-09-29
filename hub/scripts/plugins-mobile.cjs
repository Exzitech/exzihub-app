// Plugins embarques dans l'APK Android (lance par tauri.android.conf.json).
//
// Pas de catalogue sur telephone : chaque plugin dont le manifest declare
// "platforms": [..., "android"] est compile puis copie dans dist/plugins/<id>/,
// avec dist/plugins/index.json = { id: [fichiers] }, lu par lib.rs (module embarques).
// Sans champ "platforms", un plugin reste reserve au bureau.
//
// Variante (variable EXZIHUB_APK, "complet" par defaut) : quels plugins Android embarquer.
// Elle est ecrite dans dist/plugins/variante.json : l'app ne propose que les mises a jour de
// sa variante (maj_apk.rs ; publication : scripts/publier-apk.cjs).
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const sources = path.resolve(__dirname, "../../plugins-src");
const compiles = path.resolve(__dirname, "../plugins");
const cible = path.resolve(__dirname, "../dist/plugins");

// null : tous les plugins Android. "famille" : l'APK des proches, sans outils perso.
// "carnet" : l'APK de l'autre foyer, qui n'a acces qu'au carnet de liaison.
const VARIANTES = { complet: null, famille: ["croissance", "routines", "carnet"], carnet: ["carnet"] };
const variante = process.env.EXZIHUB_APK || "complet";
if (!(variante in VARIANTES)) {
  console.error(`Variante inconnue "${variante}" (EXZIHUB_APK) : ${Object.keys(VARIANTES).join(", ")}`);
  process.exit(1);
}

const android = fs.readdirSync(sources).filter((id) => {
  const fichier = path.join(sources, id, "manifest.json");
  if (!fs.existsSync(fichier)) return false;
  const platforms = JSON.parse(fs.readFileSync(fichier, "utf8")).platforms;
  return Array.isArray(platforms) && platforms.includes("android");
});
const ids = VARIANTES[variante] ?? android;
const absents = ids.filter((id) => !android.includes(id));
if (ids.length === 0 || absents.length > 0) {
  console.error(`Variante ${variante} : aucun plugin, ou sans "platforms": ["android"] : ${absents.join(", ")}`);
  process.exit(1);
}

fs.rmSync(cible, { recursive: true, force: true });
const index = {};
for (const id of ids) {
  console.log(`> Compilation de ${id} pour Android`);
  execSync("npm run build", { cwd: path.join(sources, id), stdio: "inherit" });
  const fichiers = fs.readdirSync(path.join(compiles, id), { withFileTypes: true });
  const dossier = fichiers.find((f) => !f.isFile());
  if (dossier) throw new Error(`plugins/${id}/${dossier.name} : seuls des fichiers a plat sont embarques`);
  fs.mkdirSync(path.join(cible, id), { recursive: true });
  for (const f of fichiers) fs.copyFileSync(path.join(compiles, id, f.name), path.join(cible, id, f.name));
  index[id] = fichiers.map((f) => f.name);
}
fs.writeFileSync(path.join(cible, "index.json"), JSON.stringify(index, null, 2) + "\n");
fs.writeFileSync(path.join(cible, "variante.json"), JSON.stringify({ variante }) + "\n");
console.log(`APK ${variante}, plugins embarques : ${ids.join(", ")}`);
