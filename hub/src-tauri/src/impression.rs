//! Impression d'un PDF sur Android (saveFileAs des plugins, voir save_binary_as dans lib.rs).
//!
//! Le PDF est ecrit dans le cache de l'app puis confie a la fenetre d'impression du systeme
//! (ImpressionPlugin.kt), qui propose les imprimantes et "Enregistrer au format PDF" : un seul
//! chemin couvre imprimer et enregistrer, sans permission de stockage.

use serde::Serialize;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Wry};

struct Impression(PluginHandle<Wry>);

/// Enregistre la classe Kotlin du projet Android (gen/android/.../ImpressionPlugin.kt).
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("impression")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.exzitech.exzihub", "ImpressionPlugin")?;
            app.manage(Impression(handle));
            Ok(())
        })
        .build()
}

/// Ouvre la fenetre d'impression sur `octets` ; renvoie le chemin de la copie en cache.
pub fn imprimer(app: &AppHandle, nom: &str, octets: &[u8]) -> Result<String, String> {
    #[derive(Serialize)]
    struct Args {
        chemin: String,
    }
    if !nom.to_ascii_lowercase().ends_with(".pdf") {
        return Err(format!("{nom}: only PDF files can be saved on Android"));
    }
    let dossier = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dossier).map_err(|e| format!("{}: {e}", dossier.display()))?;
    let chemin = dossier.join(nom);
    std::fs::write(&chemin, octets).map_err(|e| format!("{}: {e}", chemin.display()))?;
    let chemin = chemin.to_string_lossy().into_owned();
    app.state::<Impression>()
        .0
        .run_mobile_plugin::<()>("imprimer", Args { chemin: chemin.clone() })
        .map_err(|e| format!("Android printing: {e}"))?;
    Ok(chemin)
}
