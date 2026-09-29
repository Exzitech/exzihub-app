//! Telechargements depuis le catalogue en ligne (dossier partage Nextcloud de hub.json),
//! communs au bureau (plugins, executable du hub) et a Android (APK).

/// Adresse publique du dossier partage (hub.json). Bureau : hub.json a cote de l'executable,
/// relu a chaque appel ; Android : integre a la compilation (pas de fichier a cote de l'APK).
fn catalog_base() -> Result<String, String> {
    #[derive(serde::Deserialize)]
    struct HubConfig {
        #[serde(rename = "catalogBase")]
        catalog_base: String,
    }
    // EXZIHUB_CATALOG_BASE : surcharge pour tester contre un serveur local.
    if let Ok(base) = std::env::var("EXZIHUB_CATALOG_BASE") {
        return Ok(base);
    }
    #[cfg(desktop)]
    let raw = {
        let path = crate::hub_file("hub.json").ok_or("hub.json not found")?;
        std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?
    };
    #[cfg(mobile)]
    let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../hub.json")).to_string();
    let config: HubConfig = serde_json::from_str(&raw).map_err(|e| format!("Invalid hub.json: {e}"))?;
    Ok(config.catalog_base)
}

/// Sous-dossier du partage qui contient tout ce que l'app telecharge, index.json compris.
/// La racine du partage ne garde que ce qu'un humain installe a la main, pour rester lisible
/// par un proche qui ouvre le lien. Nom sans espace ni accent : il part tel quel dans l'URL.
/// Constante : le renommer cote Nextcloud impose de recompiler et de republier.
pub const DOSSIER_CATALOGUE: &str = "Application";

/// Adresse de telechargement d'un fichier du dossier partage.
pub fn catalog_url(file: &str) -> Result<String, String> {
    if !crate::is_safe_name(file) {
        return Err("Invalid file name".into());
    }
    Ok(format!("{}/download?path=%2F{DOSSIER_CATALOGUE}&files={file}", catalog_base()?.trim_end_matches('/')))
}

/// Telecharge une URL en memoire (200 Mo max). Bloquant : a appeler hors du thread principal.
pub fn http_get(url: &str) -> Result<Vec<u8>, String> {
    http_get_progression(url, |_| {})
}

/// Comme http_get, en appelant `progression` avec le nombre d'octets deja recus.
/// Delai par lecture (pas pour tout le fichier) : une connexion lente mais vivante aboutit.
pub fn http_get_progression(url: &str, mut progression: impl FnMut(u64)) -> Result<Vec<u8>, String> {
    use std::io::Read;
    const MAX_BYTES: u64 = 200 * 1024 * 1024;
    let response = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(20))
        .timeout_read(std::time::Duration::from_secs(60))
        .build()
        .get(url)
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;
    let mut lecteur = response.into_reader().take(MAX_BYTES);
    let mut bytes = Vec::new();
    let mut morceau = [0u8; 64 * 1024];
    loop {
        let n = lecteur.read(&mut morceau).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            return Ok(bytes);
        }
        bytes.extend_from_slice(&morceau[..n]);
        progression(bytes.len() as u64);
    }
}

/// index.json du catalogue.
pub fn catalog() -> Result<serde_json::Value, String> {
    serde_json::from_slice(&http_get(&catalog_url("index.json")?)?).map_err(|e| format!("Invalid index.json: {e}"))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Version "1.2.3" en nombres, pour comparer.
pub fn version_nombres(v: &str) -> Vec<u64> {
    v.split('.').map(|n| n.trim().parse().unwrap_or(0)).collect()
}

/// Publication d'un executable (hub ou APK) : entree {version, file, sha256} du catalogue,
/// retenue seulement si elle est plus recente que `courante`.
pub struct Publication {
    pub version: String,
    pub file: String,
    pub sha256: String,
    /// Taille en octets, si le catalogue la donne (progression affichee sur Android seulement).
    #[cfg_attr(desktop, allow(dead_code))]
    pub size: Option<u64>,
}

pub fn plus_recente(entree: &serde_json::Value, courante: &str) -> Result<Option<Publication>, String> {
    if entree.is_null() {
        return Ok(None);
    }
    let champ = |nom: &str| entree[nom].as_str().map(str::to_string).ok_or(format!("Catalog entry has no {nom}"));
    let version = champ("version")?;
    if version_nombres(&version) <= version_nombres(courante) {
        return Ok(None);
    }
    Ok(Some(Publication { version, file: champ("file")?, sha256: champ("sha256")?, size: entree["size"].as_u64() }))
}

/// Telecharge une publication et verifie son empreinte ; `progression` recoit les octets recus.
pub fn telecharger(p: &Publication, progression: impl FnMut(u64)) -> Result<Vec<u8>, String> {
    let octets = http_get_progression(&catalog_url(&p.file)?, progression)?;
    if !sha256_hex(&octets).eq_ignore_ascii_case(&p.sha256) {
        return Err(format!("{}: checksum mismatch, the download is corrupted or was modified", p.file));
    }
    Ok(octets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plus_recente_compare_les_versions() {
        let entree = |v: &str| serde_json::json!({ "version": v, "file": format!("ExziHub-{v}.exe"), "sha256": "ab" });
        assert_eq!(plus_recente(&entree("0.10.0"), "0.9.3").unwrap().unwrap().version, "0.10.0");
        assert!(plus_recente(&entree("0.2.0"), "0.2.0").unwrap().is_none());
        assert!(plus_recente(&entree("0.1.9"), "0.2.0").unwrap().is_none());
        assert!(plus_recente(&serde_json::Value::Null, "0.2.0").unwrap().is_none());
        let incomplete = serde_json::json!({ "version": "9.0.0" });
        assert!(plus_recente(&incomplete, "0.2.0").err().unwrap().contains("file"));
    }
}
