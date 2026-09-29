// Commun a publier-hub.cjs et publier-apk.cjs : dossier du catalogue, index.json, versions.
const fs = require("fs");
const path = require("path");

const hub = path.resolve(__dirname, "..");
const racine = path.resolve(hub, "..");

/** Version du hub (tauri.conf.json), verifiee identique a Cargo.toml. */
function versionHub() {
  const version = JSON.parse(fs.readFileSync(path.join(hub, "src-tauri", "tauri.conf.json"), "utf8")).version;
  const cargo = fs.readFileSync(path.join(hub, "src-tauri", "Cargo.toml"), "utf8").match(/^version = "(.+)"/m)?.[1];
  if (cargo !== version) throw new Error(`Versions differentes : tauri.conf.json ${version}, Cargo.toml ${cargo}. Les aligner avant de publier.`);
  return version;
}

/** Racine du dossier partage : celle de plugins-src/publier.local.json, sinon dist-catalogue/. */
function dossierPartage() {
  let dossier = path.join(racine, "dist-catalogue");
  const local = path.join(racine, "plugins-src", "publier.local.json");
  if (fs.existsSync(local)) dossier = JSON.parse(fs.readFileSync(local, "utf8")).dossier || dossier;
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

/** Meme nom que DOSSIER_CATALOGUE dans src-tauri/src/telechargement.rs : les changer ensemble. */
const SOUS_DOSSIER = "Application";

/**
 * Dossier de distribution : le sous-dossier qui recoit tout ce que l'app telecharge,
 * index.json compris. La racine du partage ne garde que les installeurs a lancer a la main,
 * pour rester lisible par un proche qui ouvre le lien.
 */
function dossierCatalogue() {
  const dossier = path.join(dossierPartage(), SOUS_DOSSIER);
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

const lireIndex = (dossier) => {
  const f = path.join(dossier, "index.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { plugins: [] };
};
const ecrireIndex = (dossier, index) => fs.writeFileSync(path.join(dossier, "index.json"), JSON.stringify(index, null, 2) + "\n");

/** true si la version a est strictement plus recente que b ("1.2.3"). */
function plusRecente(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map((n) => parseInt(n, 10) || 0));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/**
 * Copie `octets` sous `nom` dans le catalogue et renvoie l'entree {version, file, sha256, size}.
 * Supprime les autres fichiers de la meme serie (`serie` : RegExp des anciennes versions).
 */
function deposer(dossier, nom, octets, version, serie) {
  const crypto = require("crypto");
  fs.writeFileSync(path.join(dossier, nom), octets);
  for (const f of fs.readdirSync(dossier)) if (serie.test(f) && f !== nom) fs.rmSync(path.join(dossier, f));
  return { version, file: nom, sha256: crypto.createHash("sha256").update(octets).digest("hex"), size: octets.length };
}

module.exports = { hub, versionHub, dossierPartage, dossierCatalogue, SOUS_DOSSIER, lireIndex, ecrireIndex, plusRecente, deposer };
