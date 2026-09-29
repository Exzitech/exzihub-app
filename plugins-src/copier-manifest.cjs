// Copie manifest.json a cote du bundle : node ../copier-manifest.cjs <id-plugin>
const fs = require("fs");
const id = process.argv[2];
fs.copyFileSync("manifest.json", `../../hub/plugins/${id}/manifest.json`);
console.log(`plugin ${id} : hub/plugins/${id}/ pret`);
