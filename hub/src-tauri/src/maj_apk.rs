//! Mise a jour de l'APK Android depuis le catalogue (entree "android" de index.json,
//! publiee par hub/scripts/publier-apk.cjs). Chaque APK est une variante (plugins embarques,
//! scripts/plugins-mobile.cjs) et ne propose que les publications de sa variante.
//!
//! L'APK est telecharge dans le cache de l'app, son empreinte verifiee, puis l'installeur
//! d'Android s'ouvre (InstallateurPlugin.kt) : l'utilisateur confirme, Android exige en plus
//! la meme signature que l'app installee.

use serde::Serialize;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::telechargement::{catalog, plus_recente, telecharger, Publication};

struct Installateur(PluginHandle<Wry>);

/// Enregistre la classe Kotlin du projet Android (gen/android/.../InstallateurPlugin.kt).
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("installateur")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.exzitech.exzihub", "InstallateurPlugin")?;
            app.manage(Installateur(handle));
            Ok(())
        })
        .build()
}

/// Variante de cet APK, ecrite par scripts/plugins-mobile.cjs dans les ressources du front.
fn variante(app: &AppHandle) -> Result<String, String> {
    #[derive(serde::Deserialize)]
    struct Variante {
        variante: String,
    }
    let asset = app.asset_resolver().get("plugins/variante.json".into()).ok_or("plugins/variante.json: not embedded")?;
    let v: Variante = serde_json::from_slice(&asset.bytes).map_err(|e| format!("plugins/variante.json: {e}"))?;
    Ok(v.variante)
}

fn publication(app: &AppHandle) -> Result<Option<Publication>, String> {
    let variante = variante(app)?;
    let courante = app.package_info().version.to_string();
    plus_recente(&catalog()?["android"][&variante], &courante)
}

#[derive(Serialize)]
pub struct Disponible {
    version: String,
}

/// Version plus recente publiee pour la variante de cet APK, ou null.
#[tauri::command]
pub async fn apk_verifier(app: AppHandle) -> Result<Option<Disponible>, String> {
    tauri::async_runtime::spawn_blocking(move || publication(&app))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.map(|p| Disponible { version: p.version }))
}

/// Progression du telechargement, envoyee a la webview (evenement "maj-apk").
#[derive(Clone, Serialize)]
struct Progression {
    recu: u64,
    total: Option<u64>,
}

/// Telecharge la version publiee et ouvre l'installeur d'Android.
#[tauri::command]
pub async fn apk_installer(app: AppHandle) -> Result<(), String> {
    #[derive(Serialize)]
    struct Args {
        chemin: String,
    }
    let a = app.clone();
    let chemin = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let p = publication(&a)?.ok_or("No newer version in the catalog")?;
        // Un evenement par pourcent (ou par Mo sans taille connue) : pas un par morceau lu.
        let mut dernier = u64::MAX;
        let octets = telecharger(&p, |recu| {
            let palier = p.size.map_or(recu / 1_000_000, |t| recu * 100 / t.max(1));
            if palier != dernier {
                dernier = palier;
                let _ = a.emit("maj-apk", Progression { recu, total: p.size });
            }
        })?;
        // Le cache est le dossier expose par le FileProvider (res/xml/file_paths.xml).
        let dossier = a.path().app_cache_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dossier).map_err(|e| format!("{}: {e}", dossier.display()))?;
        let chemin = dossier.join("mise-a-jour.apk");
        std::fs::write(&chemin, octets).map_err(|e| format!("{}: {e}", chemin.display()))?;
        Ok(chemin.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())??;
    app.state::<Installateur>()
        .0
        .run_mobile_plugin::<()>("installer", Args { chemin })
        .map_err(|e| format!("Android installer: {e}"))
}
