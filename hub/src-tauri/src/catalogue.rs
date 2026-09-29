//! Catalogue en ligne : installation, mise a jour et desinstallation des plugins, et mise a
//! jour de l'executable du hub lui-meme (entree "hub" de index.json, hub/scripts/publier-hub.cjs).
//! Bureau uniquement : sur Android, les plugins sont integres a l'APK.

use crate::telechargement::{catalog, catalog_url, http_get, plus_recente, sha256_hex, telecharger};
use crate::{is_safe_name, moteurs, plugins_dir, plugins_dir_or_create};

/// Catalogue en ligne (index.json), renvoye tel quel a la webview.
#[tauri::command]
pub async fn fetch_catalog() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bytes = http_get(&catalog_url("index.json")?)?;
        String::from_utf8(bytes).map_err(|e| format!("Unreadable index.json: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn install_plugin_blocking(id: &str) -> Result<(), String> {
    use std::io::Cursor;

    if !is_safe_name(id) {
        return Err("Invalid plugin name".into());
    }
    // Le zip vient du catalogue, jamais d'une adresse fournie par la webview.
    let catalog = catalog()?;
    let entry = catalog["plugins"]
        .as_array()
        .and_then(|list| list.iter().find(|p| p["id"].as_str() == Some(id)))
        .ok_or_else(|| format!("Plugin {id} is not in the catalog"))?;
    let file = entry["file"].as_str().ok_or("Catalog entry has no file")?;
    let expected = entry["sha256"].as_str().ok_or("Catalog entry has no sha256")?;

    let bytes = http_get(&catalog_url(file)?)?;
    if !sha256_hex(&bytes).eq_ignore_ascii_case(expected) {
        return Err("Zip checksum mismatch: the download is corrupted or was modified".into());
    }

    // Extraction dans un dossier temporaire, puis echange : un echec ne casse pas l'ancienne version.
    let root = plugins_dir_or_create()?;
    let tmp = root.join(format!("{id}.tmp"));
    let target = root.join(id);
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let extract = || -> Result<(), String> {
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).map_err(|e| format!("Invalid zip: {e}"))?;
        for i in 0..archive.len() {
            let mut item = archive.by_index(i).map_err(|e| e.to_string())?;
            // enclosed_name refuse les chemins qui sortent du dossier (../).
            let Some(relative) = item.enclosed_name() else { continue };
            let out = tmp.join(relative);
            if item.is_dir() {
                std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
                std::io::copy(&mut item, &mut file).map_err(|e| e.to_string())?;
            }
        }
        let manifest = std::fs::read_to_string(tmp.join("manifest.json")).map_err(|_| "manifest.json is missing from the zip")?;
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest).map_err(|e| format!("Invalid manifest.json: {e}"))?;
        if manifest["id"].as_str() != Some(id) {
            return Err("The zip's manifest does not match the requested plugin".into());
        }
        Ok(())
    };
    if let Err(err) = extract() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(err);
    }

    // Les dependances avant l'echange : un plugin dont le pip echoue n'ecrase
    // pas la version installee, qui elle fonctionne.
    if let Err(err) = moteurs::install_requirements(&tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(err);
    }

    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&tmp, &target).map_err(|e| format!("{}: {e}", target.display()))
}

/// Telecharge et installe (ou met a jour) un plugin du catalogue.
#[tauri::command]
pub async fn install_plugin(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || install_plugin_blocking(&id))
        .await
        .map_err(|e| e.to_string())?
}

// --- Mise a jour du hub ---

/// Remplace `exe` (celui qui tourne) par `octets`. Windows interdit d'ecraser un .exe en cours
/// d'execution mais autorise de le renommer : l'ancien devient <nom>.old.exe, supprime au
/// demarrage suivant (nettoyer_ancien_exe). En cas d'echec, l'ancien reprend sa place.
fn remplacer_exe(exe: &std::path::Path, octets: &[u8]) -> Result<(), String> {
    let nouveau = exe.with_extension("new.exe");
    let ancien = exe.with_extension("old.exe");
    let erreur = |p: &std::path::Path, e: std::io::Error| format!("{}: {e}", p.display());
    std::fs::write(&nouveau, octets).map_err(|e| erreur(&nouveau, e))?;
    if ancien.exists() {
        std::fs::remove_file(&ancien).map_err(|e| erreur(&ancien, e))?;
    }
    std::fs::rename(exe, &ancien).map_err(|e| erreur(exe, e))?;
    if let Err(e) = std::fs::rename(&nouveau, exe) {
        let _ = std::fs::rename(&ancien, exe);
        return Err(erreur(exe, e));
    }
    Ok(())
}

/// Ancien executable laisse par une mise a jour. Echec ignore : juste apres le redemarrage,
/// l'ancien processus peut ne pas etre encore sorti ; il sera supprime au lancement suivant.
pub fn nettoyer_ancien_exe() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("old.exe"));
    }
}

fn update_hub_blocking(courante: &str, exe: &std::path::Path) -> Result<(), String> {
    let p = plus_recente(&catalog()?["hub"], courante)?.ok_or("No newer ExziHub in the catalog")?;
    let octets = telecharger(&p, |_| {})?;
    if !octets.starts_with(b"MZ") {
        return Err(format!("ExziHub {}: {} is not a Windows executable", p.version, p.file));
    }
    remplacer_exe(exe, &octets)
}

/// Installe la version du hub publiee dans le catalogue, puis relance le hub.
#[tauri::command]
pub async fn update_hub(app: tauri::AppHandle) -> Result<(), String> {
    // En developpement, current_exe est target/debug : rien a remplacer.
    if cfg!(debug_assertions) {
        return Err("ExziHub updates are disabled in development builds".into());
    }
    let courante = app.package_info().version.to_string();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || update_hub_blocking(&courante, &exe))
        .await
        .map_err(|e| e.to_string())??;
    app.restart()
}

/// Supprime le dossier d'un plugin installe.
#[tauri::command]
pub fn uninstall_plugin(id: String) -> Result<(), String> {
    if !is_safe_name(&id) {
        return Err("Invalid plugin name".into());
    }
    let path = plugins_dir().ok_or("Plugins folder not found")?.join(&id);
    if !path.join("manifest.json").is_file() {
        return Err(format!("Plugin {id} is not installed"));
    }
    std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};

    /// Zip d'un faux plugin, comme celui que produit plugins-src/publier.cjs.
    fn fake_zip(id: &str, version: &str) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut buf);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(format!(r#"{{"id":"{id}","name":"Test","version":"{version}"}}"#).as_bytes()).unwrap();
        zip.start_file("index.js", options).unwrap();
        zip.write_all(b"// plugin de test").unwrap();
        zip.finish().unwrap();
        buf.into_inner()
    }

    /// Serveur HTTP minimal qui imite l'adresse Nextcloud .../download?path=%2F<dossier>&files=<nom>.
    fn serve(files: Vec<(String, Vec<u8>)>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = request.lines().next().unwrap_or("");
                let body = files.iter().find(|(name, _)| {
                    line.contains(&format!("/download?path=%2F{}&files={name} ", crate::telechargement::DOSSIER_CATALOGUE))
                });
                match body {
                    Some((_, bytes)) => {
                        let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len());
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(bytes);
                    }
                    None => {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
        });
        base
    }

    fn catalog(version: &str, zip: &[u8], sha: Option<String>) -> Vec<u8> {
        let sha = sha.unwrap_or_else(|| Sha256::digest(zip).iter().map(|b| format!("{b:02x}")).collect());
        format!(
            r#"{{"plugins":[{{"id":"zz-test-plugin","version":"{version}","file":"zz-test-plugin-{version}.zip","sha256":"{sha}"}}]}}"#
        )
        .into_bytes()
    }

    #[test]
    fn remplacer_exe_garde_l_ancien_a_cote() {
        let dossier = std::env::temp_dir().join(format!("exzihub-maj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dossier);
        std::fs::create_dir_all(&dossier).unwrap();
        let exe = dossier.join("ExziHub.exe");
        std::fs::write(&exe, b"MZ v1").unwrap();
        std::fs::write(dossier.join("ExziHub.old.exe"), b"MZ v0").unwrap();

        remplacer_exe(&exe, b"MZ v2").unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"MZ v2");
        assert_eq!(std::fs::read(dossier.join("ExziHub.old.exe")).unwrap(), b"MZ v1");
        assert!(!dossier.join("ExziHub.new.exe").exists());
        std::fs::remove_dir_all(&dossier).unwrap();
    }

    #[test]
    fn install_update_uninstall() {
        let root = plugins_dir_or_create().unwrap();
        let installed = root.join("zz-test-plugin");
        let _ = std::fs::remove_dir_all(&installed);
        let version_installee = || {
            let raw = std::fs::read_to_string(installed.join("manifest.json")).unwrap();
            serde_json::from_str::<serde_json::Value>(&raw).unwrap()["version"].as_str().unwrap().to_string()
        };

        // Installation.
        let zip1 = fake_zip("zz-test-plugin", "1.0.0");
        let base = serve(vec![
            ("index.json".into(), catalog("1.0.0", &zip1, None)),
            ("zz-test-plugin-1.0.0.zip".into(), zip1),
        ]);
        std::env::set_var("EXZIHUB_CATALOG_BASE", &base);
        install_plugin_blocking("zz-test-plugin").unwrap();
        assert_eq!(version_installee(), "1.0.0");
        assert!(installed.join("index.js").is_file());
        assert!(!root.join("zz-test-plugin.tmp").exists());

        // Mise a jour.
        let zip2 = fake_zip("zz-test-plugin", "2.0.0");
        let base = serve(vec![
            ("index.json".into(), catalog("2.0.0", &zip2, None)),
            ("zz-test-plugin-2.0.0.zip".into(), zip2),
        ]);
        std::env::set_var("EXZIHUB_CATALOG_BASE", &base);
        install_plugin_blocking("zz-test-plugin").unwrap();
        assert_eq!(version_installee(), "2.0.0");

        // Empreinte incorrecte : refuse, et l'ancienne version reste en place.
        let zip3 = fake_zip("zz-test-plugin", "3.0.0");
        let base = serve(vec![
            ("index.json".into(), catalog("3.0.0", &zip3, Some("0".repeat(64)))),
            ("zz-test-plugin-3.0.0.zip".into(), zip3),
        ]);
        std::env::set_var("EXZIHUB_CATALOG_BASE", &base);
        assert!(install_plugin_blocking("zz-test-plugin").unwrap_err().contains("checksum"));
        assert_eq!(version_installee(), "2.0.0");
        assert!(!root.join("zz-test-plugin.tmp").exists());

        // Plugin absent du catalogue, et nom dangereux.
        assert!(install_plugin_blocking("autre").unwrap_err().contains("not in the catalog"));
        assert!(install_plugin_blocking("../evil").is_err());
        assert!(uninstall_plugin("../evil".into()).is_err());

        // Desinstallation.
        uninstall_plugin("zz-test-plugin".into()).unwrap();
        assert!(!installed.exists());
        assert!(uninstall_plugin("zz-test-plugin".into()).is_err());
    }
}
