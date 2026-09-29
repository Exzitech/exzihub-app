// Copie l'installateur NSIS genere par `tauri build` a la RACINE du dossier partage.
// Il y reste avec l'APK et la notice : c'est ce qu'un proche telecharge et lance a la main.
// Ce que l'app telecharge seule est range a cote, dans Application/ (voir catalogue.cjs).
const fs = require("fs");
const path = require("path");

const { dossierPartage } = require("./catalogue.cjs");

const dossierNsis = path.join(__dirname, "..", "src-tauri", "target", "release", "bundle", "nsis");
const setup = fs.readdirSync(dossierNsis).filter((f) => f.endsWith("-setup.exe")).sort().pop();
if (!setup) throw new Error(`Aucun installateur dans ${dossierNsis}`);

const cible = path.join(dossierPartage(), "ExziHub pour PC.exe");
fs.copyFileSync(path.join(dossierNsis, setup), cible);
console.log(`Installateur publie : ${cible} (${(fs.statSync(cible).size / 1024 / 1024).toFixed(1)} Mo)`);
