// Copie l'executable compile dans hub/ExziHub.exe (version distribuee).
// Windows interdit d'ecraser un .exe en cours d'execution mais autorise de le
// renommer : l'ancien devient ExziHub.old.exe, supprime a la publication suivante.
const fs = require("fs");

const source = "src-tauri/target/release/exzihub.exe";
const cible = "ExziHub.exe";
const ancien = "ExziHub.old.exe";

try { fs.rmSync(ancien, { force: true }); } catch { /* encore ouvert : on garde */ }
if (fs.existsSync(cible)) {
  try {
    fs.renameSync(cible, ancien);
  } catch {
    // L'ancien .old est encore utilise : on tente la copie directe.
  }
}
fs.copyFileSync(source, cible);
console.log("ExziHub.exe mis a jour. Relancer ExziHub pour utiliser la nouvelle version.");
