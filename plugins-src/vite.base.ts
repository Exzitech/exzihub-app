import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React vient du hub (window.ExziHub) : un plugin ne l'embarque pas, sinon deux
// copies de React cohabiteraient et les hooks casseraient.
//
// `external` ne vaut que pour le build : en developpement (npm run dev), Vite
// sert React depuis node_modules, et shared/dev.tsx le republie dans un faux
// window.ExziHub. Une seule copie dans les deux cas.
export function pluginConfig(id: string) {
  return defineConfig({
    plugins: [react()],
    define: { "process.env.NODE_ENV": '"production"' },
    server: {
      // La page de developpement charge la feuille du hub (variables de
      // couleur, classes communes), qui est hors du dossier du plugin.
      fs: { allow: ["../.."] },
    },
    build: {
      outDir: `../../hub/plugins/${id}`,
      emptyOutDir: true,
      cssCodeSplit: false,
      lib: { entry: "src/index.tsx", name: "ExziPlugin", formats: ["iife"], fileName: () => "index.js" },
      rollupOptions: {
        external: ["react", "react/jsx-runtime", "react-dom"],
        output: {
          globals: {
            react: "ExziHub.React",
            "react/jsx-runtime": "ExziHub.jsxRuntime",
            "react-dom": "ExziHub.ReactDOM",
          },
        },
      },
    },
  });
}
