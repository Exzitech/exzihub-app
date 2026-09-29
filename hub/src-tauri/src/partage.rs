//! Partage d'un fichier sur Android : ce qui remplace "Enregistrer sous" du bureau.
//!
//! Le fichier est ecrit dans le cache de l'app puis confie au menu de partage du systeme
//! (PartagePlugin.kt), ou l'utilisateur choisit Fichiers, Drive, un message... Aucune
//! permission de stockage n'est demandee. Un PDF passe plutot par la fenetre d'impression,
//! qui propose aussi "Enregistrer au format PDF" (impression.rs).

#[cfg(target_os = "android")]
use serde::Serialize;
#[cfg(target_os = "android")]
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager, Wry};

#[cfg(target_os = "android")]
struct Partage(PluginHandle<Wry>);

#[cfg(target_os = "android")]
/// Enregistre la classe Kotlin du projet Android (gen/android/.../PartagePlugin.kt).
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("partage")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.exzitech.exzihub", "PartagePlugin")?;
            app.manage(Partage(handle));
            Ok(())
        })
        .build()
}

/// Type MIME d'apres l'extension : ce que le menu de partage montre comme destinations.
#[cfg_attr(desktop, allow(dead_code))]
fn type_mime(nom: &str) -> &'static str {
    match nom.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).as_deref() {
        Some("json") => "application/json",
        Some("txt") | Some("csv") | Some("md") => "text/plain",
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    }
}

#[cfg(target_os = "android")]
/// Ouvre le menu de partage sur `octets` ; renvoie le chemin de la copie en cache.
pub fn partager(app: &AppHandle, nom: &str, octets: &[u8]) -> Result<String, String> {
    #[derive(Serialize)]
    struct Args {
        chemin: String,
        #[serde(rename = "type")]
        type_mime: String,
    }
    let dossier = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dossier).map_err(|e| format!("{}: {e}", dossier.display()))?;
    let chemin = dossier.join(nom);
    std::fs::write(&chemin, octets).map_err(|e| format!("{}: {e}", chemin.display()))?;
    let chemin = chemin.to_string_lossy().into_owned();
    app.state::<Partage>()
        .0
        .run_mobile_plugin::<()>("partager", Args { chemin: chemin.clone(), type_mime: type_mime(nom).into() })
        .map_err(|e| format!("Android sharing: {e}"))?;
    Ok(chemin)
}

#[cfg(test)]
mod tests {
    use super::type_mime;

    #[test]
    fn types_mime_des_exports() {
        assert_eq!(type_mime("chemins.json"), "application/json");
        assert_eq!(type_mime("Ma journee.PDF"), "application/pdf");
        assert_eq!(type_mime("photo.jpeg"), "image/jpeg");
        assert_eq!(type_mime("sans-extension"), "application/octet-stream");
    }
}
