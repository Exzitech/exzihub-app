// Publie un plugin : node plugins-src/publier.cjs <id-plugin>   (ou "all" pour tous)
//
// Compile le plugin, le zippe (<id>-<version>.zip), calcule son SHA-256 et met a jour
// index.json dans le dossier de distribution, defini par hub/scripts/catalogue.cjs : le
// sous-dossier Application/ du partage Nextcloud synchronise, ou a defaut
// dist-catalogue/Application/ a la racine du depot, a deposer a la main.
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const id = process.argv[2];
if (!id) {
  console.error("Usage : node plugins-src/publier.cjs <id-plugin | all>");
  process.exit(1);
}
if (id === "all") {
  const ids = fs.readdirSync(__dirname).filter((d) => fs.existsSync(path.join(__dirname, d, "manifest.json")));
  for (const one of ids) execSync(`node "${__filename}" ${one}`, { stdio: "inherit" });
  process.exit(0);
}

const racine = path.resolve(__dirname, "..");
const source = path.join(__dirname, id);
const installe = path.join(racine, "hub", "plugins", id);
if (!fs.existsSync(path.join(source, "manifest.json"))) {
  console.error(`Plugin inconnu : plugins-src/${id}/manifest.json introuvable`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
if (manifest.id !== id) {
  console.error(`manifest.json declare l'id "${manifest.id}", attendu "${id}"`);
  process.exit(1);
}

const dossier = require(path.join(racine, "hub", "scripts", "catalogue.cjs")).dossierCatalogue();

console.log(`> Compilation de ${id} ${manifest.version}`);
execSync("npm run build", { cwd: source, stdio: "inherit" });

// Zip : fichiers a la racine de l'archive. On appelle le tar de Windows (bsdtar) par son
// chemin : le GNU tar de Git Bash, s'il est en tete du PATH, lit "C:" comme un nom d'hote.
const nomZip = `${id}-${manifest.version}.zip`;
const zip = path.join(dossier, nomZip);
fs.rmSync(zip, { force: true });
execSync(`"${path.join(process.env.SystemRoot || "C:\Windows", "System32", "tar.exe")}" -a -c -f "${zip}" ${fs.readdirSync(installe).map((f) => `"${f}"`).join(" ")}`, { cwd: installe, stdio: "inherit" });

const octets = fs.readFileSync(zip);
const entree = {
  id,
  name: manifest.name,
  icon: manifest.icon,
  category: manifest.category,
  subcategory: manifest.subcategory,
  version: manifest.version,
  description: manifest.description,
  file: nomZip,
  sha256: crypto.createHash("sha256").update(octets).digest("hex"),
  size: octets.length,
};

const fichierIndex = path.join(dossier, "index.json");
const index = fs.existsSync(fichierIndex) ? JSON.parse(fs.readFileSync(fichierIndex, "utf8")) : { plugins: [] };
index.plugins = [...index.plugins.filter((p) => p.id !== id), entree].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(fichierIndex, JSON.stringify(index, null, 2) + "\n");

// Les anciennes versions du meme plugin n'ont plus lieu d'etre dans le dossier.
for (const f of fs.readdirSync(dossier)) {
  if (f.startsWith(`${id}-`) && f.endsWith(".zip") && f !== nomZip) fs.rmSync(path.join(dossier, f));
}

console.log(`\nPublie dans ${dossier}\n  ${nomZip} (${(octets.length / 1024).toFixed(0)} Ko)\n  index.json mis a jour`);
