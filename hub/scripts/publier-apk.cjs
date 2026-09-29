// Publie un APK Android dans le catalogue : npm run publier-apk -- <variante>  (complet | famille)
//
// Compile l'APK de la variante (EXZIHUB_APK, voir plugins-mobile.cjs), le copie en
// ExziHub-<variante>-<version>.apk dans le dossier de distribution et renseigne l'entree
// "android"."<variante>" de index.json : les apps de cette variante proposent la mise a jour
// au lancement (maj_apk.rs). Une version publiee ne se republie pas : augmenter la version.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { hub, versionHub, dossierPartage, dossierCatalogue, lireIndex, ecrireIndex, plusRecente, deposer } = require("./catalogue.cjs");

const variante = process.argv[2];
if (!/^[a-z]+$/.test(variante ?? "")) throw new Error("Usage : npm run publier-apk -- <variante>  (complet | famille)");
const version = versionHub();
const dossier = dossierCatalogue();
const publiee = lireIndex(dossier).android?.[variante];
if (publiee && !plusRecente(version, publiee.version)) {
  throw new Error(`APK ${variante} ${publiee.version} deja publie : augmenter la version (tauri.conf.json et Cargo.toml).`);
}

// Rust optimise pour la taille : APK ~40 % plus leger a telecharger, sans effet sensible
// sur Android (synchro, pas de calcul lourd). Le bureau garde l'optimisation par defaut.
const env = { ...process.env, EXZIHUB_APK: variante, CARGO_PROFILE_RELEASE_OPT_LEVEL: "z", CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "1" };
execSync("npx tauri android build --apk --target aarch64", { cwd: hub, stdio: "inherit", env });
const apk = path.join(hub, "src-tauri", "gen", "android", "app", "build", "outputs", "apk", "universal", "release", "app-universal-release.apk");
const octets = fs.readFileSync(apk);

const index = lireIndex(dossier);
index.android = { ...index.android, [variante]: deposer(dossier, `ExziHub-${variante}-${version}.apk`, octets, version, new RegExp(`^ExziHub-${variante}-[\\d.]+\\.apk$`)) };
ecrireIndex(dossier, index);

// L'APK des proches est aussi depose a la racine du partage, sous un nom stable : c'est
// celui qu'ils telechargent a la main, a cote de l'installeur PC et de la notice. Les mises
// a jour suivantes se font depuis l'app, qui lit la copie versionnee d'Application/.
if (variante === "famille") {
  const copie = path.join(dossierPartage(), "ExziHub pour Android.apk");
  fs.writeFileSync(copie, octets);
  console.log(`Copie pour installation manuelle : ${copie}`);
}
console.log(`APK ${variante} ${version} publie dans ${dossier} (${(octets.length / 1024 / 1024).toFixed(1)} Mo), index.json mis a jour`);
