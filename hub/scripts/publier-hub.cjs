// Publie l'executable du hub dans le catalogue : npm run publier (compile d'abord).
//
// Copie target/release/exzihub.exe en ExziHub-<version>.exe dans le dossier de distribution
// et renseigne l'entree "hub" de index.json : les hubs installes proposent alors la mise a
// jour dans l'ecran Tools (catalogue.rs, update_hub). Les hubs anterieurs a 0.2.0 l'ignorent.
const fs = require("fs");
const path = require("path");
const { hub, versionHub, dossierCatalogue, lireIndex, ecrireIndex, plusRecente, deposer } = require("./catalogue.cjs");

const version = versionHub();
const dossier = dossierCatalogue();
const index = lireIndex(dossier);
if (index.hub && !plusRecente(version, index.hub.version)) {
  throw new Error(`Le catalogue a deja ExziHub ${index.hub.version} : augmenter la version (tauri.conf.json et Cargo.toml) puis recompiler.`);
}

const octets = fs.readFileSync(path.join(hub, "src-tauri", "target", "release", "exzihub.exe"));
// L'installeur est a la racine du partage, hors de ce dossier : jamais dans la serie.
index.hub = deposer(dossier, `ExziHub-${version}.exe`, octets, version, /^ExziHub-\d[\d.]*\.exe$/);
ecrireIndex(dossier, index);
console.log(`ExziHub ${version} publie dans ${dossier} (${(octets.length / 1024 / 1024).toFixed(1)} Mo), index.json mis a jour`);
