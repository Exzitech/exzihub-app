//! Coeur du hub, partage par le bureau (main.rs) et Android (point d'entree mobile).
//! Ce qui ne tourne que sous Windows (moteurs Python, catalogue, icone de notification)
//! est compile seulement pour le bureau : `cfg(desktop)`, fourni par tauri-build.

use std::path::PathBuf;

#[cfg(desktop)]
mod catalogue;
#[cfg(target_os = "android")]
mod impression;
#[cfg(target_os = "android")]
mod maj_apk;
#[cfg(desktop)]
mod moteurs;
mod partage;
#[cfg(desktop)]
mod reglages;
mod synchro;
mod telechargement;
#[cfg(desktop)]
mod tray;

/// Fichier de configuration du hub : a cote de l'executable (installation),
/// sinon racine du hub (dev).
fn hub_file(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        candidates.push(dir.join(name));
    }
    candidates.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/..")).join(name));
    candidates.into_iter().find(|p| p.is_file())
}

fn tools_path() -> Option<PathBuf> {
    hub_file("tools.json")
}

/// Relu a chaque lancement pour que tools.json reste editable a la main.
#[tauri::command]
fn load_tools() -> Result<String, String> {
    let path = tools_path().ok_or("tools.json introuvable")?;
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// plugins/ : a cote de l'executable (installation), sinon racine du hub (dev).
#[cfg(desktop)]
fn plugins_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        candidates.push(dir.join("plugins"));
    }
    candidates.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../plugins")));
    candidates.into_iter().find(|p| p.is_dir())
}

/// Dossier de travail d'un moteur de plugin : donnees/<id>/, a cote de plugins/.
///
/// Hors de plugins/<id>/, qui est efface et remplace a chaque mise a jour : ce
/// qu'un moteur ecrit (reglages, zone de capture, pack de langue, journaux)
/// doit survivre a une nouvelle version, et ne jamais transiter par le zip.
/// Transmis au moteur dans EXZIHUB_DONNEES au lancement.
#[cfg(desktop)]
fn donnees_dir(id: &str) -> Option<PathBuf> {
    // Meme racine que plugins/, pour que les deux ne puissent pas diverger.
    let dir = plugins_dir_or_create().ok()?.parent()?.join("donnees").join(id);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Nom de dossier ou de fichier sans separateur : la webview ne sort jamais de plugins/.
fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Mobile : pas de catalogue, les plugins sont embarques dans les ressources du front
/// (dist/plugins/<id>/, copies au build par scripts/plugins-mobile.cjs). L'index
/// plugins/index.json ({ id: [fichiers] }) les liste et sert de garde : Tauri renvoie
/// index.html pour un chemin absent au lieu d'une erreur.
#[cfg(mobile)]
mod embarques {
    use std::collections::HashMap;

    fn lire(app: &tauri::AppHandle, path: &str) -> Result<String, String> {
        let asset = app.asset_resolver().get(path.to_string()).ok_or_else(|| format!("{path}: not embedded"))?;
        String::from_utf8(asset.bytes).map_err(|e| format!("{path}: {e}"))
    }

    fn index(app: &tauri::AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
        serde_json::from_str(&lire(app, "plugins/index.json")?).map_err(|e| format!("plugins/index.json: {e}"))
    }

    pub fn fichier(app: &tauri::AppHandle, id: &str, file: &str) -> Result<String, String> {
        if !index(app)?.get(id).is_some_and(|files| files.iter().any(|f| f == file)) {
            return Err(format!("plugins/{id}/{file}: not embedded"));
        }
        lire(app, &format!("plugins/{id}/{file}"))
    }

    pub fn manifests(app: &tauri::AppHandle) -> Result<String, String> {
        let mut manifests = Vec::new();
        for id in index(app)?.keys() {
            let raw = fichier(app, id, "manifest.json")?;
            let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("plugins/{id}/manifest.json: {e}"))?;
            manifests.push(value);
        }
        Ok(serde_json::Value::Array(manifests).to_string())
    }
}

#[cfg(mobile)]
#[tauri::command]
fn list_plugins(app: tauri::AppHandle) -> Result<String, String> {
    embarques::manifests(&app)
}

#[cfg(mobile)]
#[tauri::command]
fn read_plugin_file(app: tauri::AppHandle, id: String, file: String) -> Result<String, String> {
    if !is_safe_name(&id) || !is_safe_name(&file) {
        return Err("Invalid plugin or file name".into());
    }
    embarques::fichier(&app, &id, &file)
}

/// Manifests des plugins installes (plugins/<id>/manifest.json), en tableau JSON.
/// Un dossier sans manifest lisible est ignore.
#[cfg(desktop)]
#[tauri::command]
fn list_plugins() -> String {
    let mut manifests = Vec::new();
    if let Some(dir) = plugins_dir() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().ends_with(".tmp") {
                    continue; // installation en cours
                }
                let Ok(raw) = std::fs::read_to_string(entry.path().join("manifest.json")) else { continue };
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                    manifests.push(value);
                }
            }
        }
    }
    serde_json::Value::Array(manifests).to_string()
}

/// Lit un fichier texte d'un plugin (index.js, style.css...).
#[cfg(desktop)]
#[tauri::command]
fn read_plugin_file(id: String, file: String) -> Result<String, String> {
    if !is_safe_name(&id) || !is_safe_name(&file) {
        return Err("Invalid plugin or file name".into());
    }
    let path = plugins_dir().ok_or("Plugins folder not found")?.join(&id).join(&file);
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Dossier plugins/, cree au besoin a cote de l'executable.
#[cfg(desktop)]
fn plugins_dir_or_create() -> Result<PathBuf, String> {
    if let Some(dir) = plugins_dir() {
        return Ok(dir);
    }
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("plugins")))
        .ok_or("Plugins folder not found")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

/// Nom de fichier reduit a des caracteres surs : la webview ne choisit jamais le dossier.
fn nom_sur(name: &str) -> Result<String, String> {
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("Invalid file name".into());
    }
    Ok(safe)
}

/// Chemin d'un export dans Telechargements.
#[cfg(desktop)]
fn export_path(name: &str) -> Result<PathBuf, String> {
    let safe = nom_sur(name)?;
    let dir = std::env::var_os("USERPROFILE")
        .map(|home| PathBuf::from(home).join("Downloads"))
        .filter(|d| d.is_dir())
        .or_else(|| std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)))
        .ok_or("Export folder not found")?;
    Ok(dir.join(safe))
}

/// Ecrit un export texte (chemins...) dans le dossier Telechargements et renvoie son chemin.
/// Sur Android, il n'y a pas de dossier de l'app accessible a l'utilisateur : l'export passe
/// par le menu de partage, qui permet de l'enregistrer ou de l'envoyer (partage.rs).
#[tauri::command]
#[cfg_attr(desktop, allow(unused_variables))]
fn export_file(app: tauri::AppHandle, name: String, contents: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    return partage::partager(&app, &nom_sur(&name)?, contents.as_bytes());

    #[cfg(desktop)]
    {
        let path = export_path(&name)?;
        std::fs::write(&path, contents).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(path.display().to_string())
    }
}

/// "Enregistrer sous" pour un fichier binaire (PDF...) : octets en corps brut, nom
/// propose dans l'en-tete x-file-name. La fenetre est ouverte ici : la webview ne
/// fournit jamais de chemin. Renvoie None si l'utilisateur annule.
/// Sur Android, un PDF passe par la fenetre d'impression du systeme, qui propose aussi
/// "Enregistrer au format PDF" (impression.rs), les autres fichiers par le menu de partage
/// (partage.rs) ; le chemin renvoye est la copie en cache.
/// async : la boite de dialogue bloquante ne doit pas tourner sur le thread principal.
#[tauri::command]
async fn save_binary_as(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    // Android : la webview ne lit pas le corps des requetes, Tauri y envoie donc les octets
    // en tableau JSON (scripts/ipc-protocol.js de tauri) ; le bureau recoit le corps brut.
    let bytes: std::borrow::Cow<[u8]> = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.into(),
        tauri::ipc::InvokeBody::Json(v) => {
            serde_json::from_value::<Vec<u8>>(v.clone()).map_err(|_| "Binary body expected")?.into()
        }
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing x-file-name header")?;

    // Android : un PDF va a la fenetre d'impression (qui enregistre aussi), le reste
    // au menu de partage ; dans les deux cas l'utilisateur choisit la destination.
    #[cfg(target_os = "android")]
    {
        let nom = nom_sur(name)?;
        return if nom.to_ascii_lowercase().ends_with(".pdf") {
            impression::imprimer(&app, &nom, &bytes).map(Some)
        } else {
            partage::partager(&app, &nom, &bytes).map(Some)
        };
    }

    #[cfg(desktop)]
    {
        let suggested = export_path(name)?;
        let mut dialog = tauri_plugin_dialog::DialogExt::dialog(&app).file().set_file_name(
            suggested.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        );
        if let Some(dir) = suggested.parent() {
            dialog = dialog.set_directory(dir);
        }
        if suggested.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
            dialog = dialog.add_filter("PDF", &["pdf"]);
        }
        let Some(chosen) = dialog.blocking_save_file() else { return Ok(None) };
        let path = chosen.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, &*bytes).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Some(path.display().to_string()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(maj_apk::init())
        .plugin(impression::init())
        .plugin(partage::init())
        .setup(|app| {
            synchro::demarrer_veille(app.handle().clone());
            Ok(())
        });
    #[cfg(desktop)]
    let builder = builder
        // Premier plugin : une deuxieme instance se ferme aussitot et ramene la fenetre de la premiere.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::afficher_hub(app)))
        .manage(moteurs::Processes::default())
        .setup(|app| {
            catalogue::nettoyer_ancien_exe();
            synchro::demarrer_veille(app.handle().clone());
            // Sans icone, fermer la fenetre principale quitte comme avant.
            if let Err(e) = tray::creer(app.handle()) {
                eprintln!("Tray icon unavailable: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            tray::fenetre_evenement(window, event);
        });
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            load_tools, export_file, save_binary_as, list_plugins, read_plugin_file,
            synchro::sync_etat, synchro::sync_connecter, synchro::sync_annuler_connexion, synchro::sync_deconnecter,
            synchro::sync_choisir, synchro::sync_lire, synchro::sync_ecrire,
            synchro::sync_lister, synchro::sync_lire_octets, synchro::sync_ecrire_octets, synchro::sync_supprimer,
            synchro::sync_veille,
            #[cfg(desktop)] moteurs::start_tool, #[cfg(desktop)] moteurs::stop_tool, #[cfg(desktop)] moteurs::tool_running,
            #[cfg(desktop)] catalogue::fetch_catalog, #[cfg(desktop)] catalogue::install_plugin,
            #[cfg(desktop)] catalogue::uninstall_plugin, #[cfg(desktop)] catalogue::update_hub,
            #[cfg(target_os = "android")] maj_apk::apk_verifier, #[cfg(target_os = "android")] maj_apk::apk_installer
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement d'ExziHub")
        .run(|app, event| {
            // Fermer le hub n'abandonne pas de backends orphelins.
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                let processes = app.state::<moteurs::Processes>();
                for (_, mut child) in processes.0.lock().unwrap().drain() {
                    moteurs::kill_tree(&mut child);
                }
            }
            #[cfg(mobile)]
            let _ = (app, event);
        });
}

