// Copie le moteur Python a cote du bundle : node ../copier-moteur.cjs <id-plugin>
//
// Un plugin a moteur embarque son backend dans son zip (moteur/), avec son
// requirements.txt : le hub le lance via le "launch" du manifest et installe
// ses dependances a l'installation.
//
// Restent au depot : les tests, les caches, et config.json, qui contient les
// reglages de la machine de developpement (zone de capture) - le moteur le
// recree au premier lancement chez l'utilisateur.
const fs = require("fs");
const path = require("path");

const id = process.argv[2];
if (!id) {
  console.error("Usage : node copier-moteur.cjs <id-plugin>");
  process.exit(1);
}

const source = path.join(process.cwd(), "moteur");
const cible = path.join(__dirname, "..", "hub", "plugins", id, "moteur");
if (!fs.existsSync(source)) {
  console.error(`Pas de moteur/ dans ${process.cwd()}`);
  process.exit(1);
}

// Le paquet ne contient que ce qu'il faut pour tourner :
//  - tests, pytest.ini, __pycache__, .pytest_cache : outillage de developpement ;
//  - legacy : ancien code garde au depot, que plus rien ne lance ;
//  - config.json, *.log, whitelist.tessconfig : etat de la machine, ecrit dans
//    le dossier de donnees a l'execution (voir moteur/donnees.py).
const ignore = new Set([
  "tests", "pytest.ini", "__pycache__", ".pytest_cache",
  "legacy",
  "config.json", "whitelist.tessconfig",
]);
fs.rmSync(cible, { recursive: true, force: true });
fs.cpSync(source, cible, {
  recursive: true,
  filter: (src) => !ignore.has(path.basename(src)) && !src.endsWith(".log"),
});

// requirements.txt est lu par le hub a la racine du plugin, pas dans moteur/.
const requirements = path.join(source, "requirements.txt");
if (fs.existsSync(requirements)) {
  fs.copyFileSync(requirements, path.join(__dirname, "..", "hub", "plugins", id, "requirements.txt"));
}

const fichiers = fs.readdirSync(cible).length;
console.log(`plugin ${id} : moteur/ copie (${fichiers} entrees)`);
