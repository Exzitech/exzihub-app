//! Synchro des plugins sur Nextcloud (WebDAV), identique sur le bureau et Android.
//!
//! - Le compte se connecte par le « Login Flow v2 » de Nextcloud : le navigateur ouvre la page
//!   de connexion et le hub recoit un mot de passe d'application, propre au hub et revocable
//!   depuis Nextcloud. Le vrai mot de passe n'est jamais saisi dans le hub.
//! - Chaque plugin a son espace : un dossier du compte, ou un lien de partage public
//!   (un autre foyer, sans compte sur ce Nextcloud).
//! - Aucune ecriture aveugle : on modifie la version lue (If-Match) ou on cree un fichier
//!   qui n'existe pas (If-None-Match). Un fichier change ailleurs entre-temps est un conflit,
//!   que l'appelant resout en relisant ; rien n'est ecrase en silence.
//! - Hors ligne, la lecture rend la derniere copie connue ; l'ecriture echoue explicitement.
//!
//! Reglages dans synchro.json (dossier de config de l'app) : le mot de passe d'application
//! y est en clair, comme il le serait pour tout programme de la session dans le Gestionnaire
//! d'identification ; sur Android ce dossier est prive a l'app.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::is_safe_name;

const DELAI: Duration = Duration::from_secs(20);
/// Le jeton du Login Flow vit 20 minutes cote Nextcloud.
const ATTENTE_CONNEXION: Duration = Duration::from_secs(15 * 60);

/// Vrai pour interrompre une connexion en attente (navigateur ferme sans se connecter).
static ANNULER_CONNEXION: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
struct Compte {
    /// https://cloud.exemple.fr, sans / final.
    serveur: String,
    /// Identifiant Nextcloud (celui des chemins WebDAV, pas forcement celui de connexion).
    utilisateur: String,
    /// Nom de connexion renvoye par le Login Flow (authentification).
    connexion: String,
    mot_de_passe: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Espace {
    /// Dossier du compte connecte, ex. "ExziHub/Budget".
    Compte { dossier: String },
    /// Lien de partage public (https://cloud/s/<jeton>), mot de passe du partage eventuel.
    #[serde(rename_all = "camelCase")]
    Lien { lien: String, #[serde(default)] mot_de_passe: String },
}

#[derive(Serialize, Deserialize, Default)]
struct Reglages {
    compte: Option<Compte>,
    #[serde(default)]
    espaces: HashMap<String, Espace>,
    /// Plugins dont l'espace est surveille (voir la section Veille) ; absent = pas de veille.
    #[serde(default)]
    veilles: HashMap<String, Veille>,
}

/// Ce qu'un plugin demande a la veille : ce qu'elle regarde et ce qu'elle annonce.
/// Les textes viennent du plugin, qui seul connait sa langue et son vocabulaire.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Veille {
    /// Titre de la notification, ex. "Carnet de liaison".
    titre: String,
    /// Corps, ou {n} est remplace par le nombre de nouveaux fichiers.
    message: String,
    /// Seuls les fichiers commencant par ce prefixe comptent (les photos ne sont pas des entrees).
    prefixe: String,
}

/// Adresse WebDAV d'un dossier (terminee par /) et en-tete d'authentification.
#[derive(Debug, PartialEq)]
struct Cible {
    base: String,
    auth: Option<String>,
}

/// Echec d'une requete : reseau injoignable (on peut se rabattre sur le cache) ou autre.
#[derive(Debug)]
enum Echec {
    HorsLigne(String),
    Erreur(String),
}

impl From<Echec> for String {
    fn from(e: Echec) -> String {
        match e {
            Echec::HorsLigne(detail) => format!("No connection to Nextcloud ({detail})"),
            Echec::Erreur(detail) => detail,
        }
    }
}

// --- Petits outils (pas de dependance pour si peu) ---

fn base64(octets: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut sortie = String::with_capacity(octets.len().div_ceil(3) * 4);
    for bloc in octets.chunks(3) {
        let n = (bloc[0] as u32) << 16 | (*bloc.get(1).unwrap_or(&0) as u32) << 8 | *bloc.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= bloc.len() {
                sortie.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                sortie.push('=');
            }
        }
    }
    sortie
}

/// Decode du base64 (photos recues du front) ; refuse un caractere inattendu.
fn debase64(texte: &str) -> Result<Vec<u8>, String> {
    let mut octets = Vec::with_capacity(texte.len() / 4 * 3);
    let (mut tampon, mut bits) = (0u32, 0u32);
    for c in texte.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let valeur = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("Invalid base64 content".into()),
        };
        tampon = tampon << 6 | valeur as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            octets.push((tampon >> bits) as u8);
        }
    }
    Ok(octets)
}

fn basic(utilisateur: &str, mot_de_passe: &str) -> String {
    format!("Basic {}", base64(format!("{utilisateur}:{mot_de_passe}").as_bytes()))
}

/// Encode un segment de chemin d'URL (espaces, accents...).
fn encoder_segment(segment: &str) -> String {
    segment
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// https obligatoire : le mot de passe d'application part dans chaque requete.
/// http n'est admis que vers la machine elle-meme (tests).
///
/// Une adresse copiee depuis le navigateur (…/index.php/apps/files, …/settings/user?x=1)
/// est ramenee a la racine de l'installation : on coupe au premier chemin propre a
/// Nextcloud, ce qui preserve les installations dans un sous-dossier (https://h/nextcloud).
fn verifier_serveur(adresse: &str) -> Result<String, String> {
    let adresse = adresse.trim();
    let adresse = adresse.split(['?', '#']).next().unwrap_or(adresse);
    let coupe = ["/index.php", "/apps/", "/settings/", "/login", "/s/"]
        .iter()
        .filter_map(|marque| adresse.find(marque))
        .min()
        .unwrap_or(adresse.len());
    let adresse = adresse[..coupe].trim_end_matches('/');
    let local = adresse.starts_with("http://127.0.0.1") || adresse.starts_with("http://localhost");
    if !adresse.starts_with("https://") && !local {
        return Err("The Nextcloud address must start with https://".into());
    }
    if adresse.len() <= "https://".len() || adresse.contains(char::is_whitespace) {
        return Err("Invalid Nextcloud address".into());
    }
    Ok(adresse.to_string())
}

/// Dossier du compte : segments non vides, sans . ni .. (on ne sort pas du compte).
fn segments_dossier(dossier: &str) -> Result<Vec<&str>, String> {
    let segments: Vec<&str> = dossier.split('/').map(str::trim).filter(|s| !s.is_empty()).collect();
    if segments.is_empty() || segments.iter().any(|s| *s == "." || *s == "..") {
        return Err("Invalid folder".into());
    }
    Ok(segments)
}

/// https://cloud/s/<jeton> (ou /index.php/s/<jeton>) -> (https://cloud, jeton).
fn analyser_lien(lien: &str) -> Result<(String, String), String> {
    let lien = lien.trim().trim_end_matches('/');
    let (debut, jeton) = lien.rsplit_once("/s/").ok_or("This is not a Nextcloud share link (…/s/…)")?;
    if jeton.is_empty() || !jeton.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid share link".into());
    }
    let serveur = verifier_serveur(debut.trim_end_matches("/index.php"))?;
    Ok((serveur, jeton.to_string()))
}

fn cible(compte: Option<&Compte>, espace: &Espace) -> Result<Cible, String> {
    match espace {
        Espace::Compte { dossier } => {
            let compte = compte.ok_or("Not connected to Nextcloud")?;
            let mut base = format!("{}/remote.php/dav/files/{}/", compte.serveur, encoder_segment(&compte.utilisateur));
            for segment in segments_dossier(dossier)? {
                base.push_str(&encoder_segment(segment));
                base.push('/');
            }
            Ok(Cible { base, auth: Some(basic(&compte.connexion, &compte.mot_de_passe)) })
        }
        // WebDAV public (Nextcloud 29+) : utilisateur "anonymous", mot de passe du partage.
        Espace::Lien { lien, mot_de_passe } => {
            let (serveur, jeton) = analyser_lien(lien)?;
            let auth = (!mot_de_passe.is_empty()).then(|| basic("anonymous", mot_de_passe));
            Ok(Cible { base: format!("{serveur}/public.php/dav/files/{jeton}/"), auth })
        }
    }
}

// --- HTTP ---

fn json<T: serde::de::DeserializeOwned>(reponse: ureq::Response) -> Result<T, String> {
    let texte = reponse.into_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&texte).map_err(|e| e.to_string())
}

fn requete(methode: &str, url: &str, auth: Option<&str>) -> ureq::Request {
    // Nom sous lequel Nextcloud liste le mot de passe d'application (Parametres > Securite).
    let r = ureq::request(methode, url).timeout(DELAI).set("User-Agent", "ExziHub");
    match auth {
        Some(a) => r.set("Authorization", a),
        None => r,
    }
}

/// Reponse, ou code HTTP d'erreur (404, 412...) a interpreter par l'appelant.
fn envoyer(r: ureq::Request, corps: Option<&[u8]>) -> Result<Result<ureq::Response, u16>, Echec> {
    let resultat = match corps {
        Some(c) => r.send_bytes(c),
        None => r.call(),
    };
    match resultat {
        Ok(reponse) => Ok(Ok(reponse)),
        Err(ureq::Error::Status(401, _)) => {
            Err(Echec::Erreur("Nextcloud refused the credentials (disconnected, or share password changed)".into()))
        }
        Err(ureq::Error::Status(code, _)) => Ok(Err(code)),
        Err(ureq::Error::Transport(t)) => Err(Echec::HorsLigne(t.to_string())),
    }
}

/// Version d'un fichier. OC-ETag d'abord : Apache ajoute "-gzip" a l'ETag d'une reponse
/// compressee (ureq demande gzip), et Nextcloud refuse ensuite cet ETag dans If-Match (412).
fn etag(reponse: &ureq::Response) -> Option<String> {
    reponse.header("OC-ETag").or_else(|| reponse.header("ETag")).map(str::to_string)
}

/// Octets et version d'un fichier ; None s'il n'existe pas.
fn lire_octets_distant(cible: &Cible, nom: &str) -> Result<Option<(Vec<u8>, String)>, Echec> {
    match envoyer(requete("GET", &format!("{}{nom}", cible.base), cible.auth.as_deref()), None)? {
        Ok(reponse) => {
            let version = etag(&reponse).ok_or_else(|| Echec::Erreur("Nextcloud sent no version (ETag)".into()))?;
            let mut octets = Vec::new();
            std::io::Read::read_to_end(&mut reponse.into_reader(), &mut octets)
                .map_err(|e| Echec::HorsLigne(e.to_string()))?;
            Ok(Some((octets, version)))
        }
        Err(404) => Ok(None),
        Err(code) => Err(Echec::Erreur(format!("Nextcloud error {code} while reading {nom}"))),
    }
}

/// Contenu et version d'un fichier texte ; None s'il n'existe pas.
fn lire_distant(cible: &Cible, nom: &str) -> Result<Option<(String, String)>, Echec> {
    match lire_octets_distant(cible, nom)? {
        Some((octets, version)) => {
            let texte = String::from_utf8(octets).map_err(|_| Echec::Erreur(format!("{nom} is not a text file")))?;
            Ok(Some((texte, version)))
        }
        None => Ok(None),
    }
}

/// Ecrit si le fichier est toujours a la version `version` (None : s'il n'existe pas encore).
/// Renvoie la nouvelle version, ou None en cas de conflit (modifie ou cree ailleurs entre-temps).
fn ecrire_octets_distant(cible: &Cible, nom: &str, octets: &[u8], version: Option<&str>) -> Result<Option<String>, Echec> {
    let mut r = requete("PUT", &format!("{}{nom}", cible.base), cible.auth.as_deref())
        .set("Content-Type", "application/octet-stream");
    r = match version {
        Some(v) => r.set("If-Match", v),
        None => r.set("If-None-Match", "*"),
    };
    match envoyer(r, Some(octets))? {
        Ok(reponse) => match etag(&reponse) {
            Some(v) => Ok(Some(v)),
            // Sans ETag dans la reponse, on relit pour connaitre la version ecrite.
            None => lire_octets_distant(cible, nom)?
                .map(|(_, v)| Some(v))
                .ok_or_else(|| Echec::Erreur(format!("{nom} disappeared right after being written"))),
        },
        Err(412) => Ok(None),
        Err(code) => Err(Echec::Erreur(format!("Nextcloud error {code} while writing {nom}"))),
    }
}

fn ecrire_distant(cible: &Cible, nom: &str, texte: &str, version: Option<&str>) -> Result<Option<String>, Echec> {
    ecrire_octets_distant(cible, nom, texte.as_bytes(), version)
}

/// Un fichier de l'espace du plugin, vu par la liste.
#[derive(Serialize, Debug, PartialEq)]
pub struct Fichier {
    nom: String,
    version: String,
    taille: u64,
}

/// Valeur textuelle du premier element `<...:balise>` d'un fragment XML, quel que soit
/// le prefixe de namespace (d:, D:, aucun selon les serveurs).
fn valeur_xml<'a>(fragment: &'a str, balise: &str) -> Option<&'a str> {
    for morceau in fragment.split('<').skip(1) {
        let Some((ouvrante, reste)) = morceau.split_once('>') else { continue };
        let nom = ouvrante.split_whitespace().next().unwrap_or(ouvrante);
        if nom.rsplit(':').next() == Some(balise) {
            return reste.split('<').next();
        }
    }
    None
}

fn depourcenter(texte: &str) -> String {
    let octets = texte.as_bytes();
    let mut sortie = Vec::with_capacity(octets.len());
    let mut i = 0;
    while i < octets.len() {
        match (octets[i], octets.get(i + 1), octets.get(i + 2)) {
            (b'%', Some(a), Some(b)) => match u8::from_str_radix(&format!("{}{}", *a as char, *b as char), 16) {
                Ok(o) => {
                    sortie.push(o);
                    i += 3;
                }
                Err(_) => {
                    sortie.push(b'%');
                    i += 1;
                }
            },
            _ => {
                sortie.push(octets[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&sortie).into_owned()
}

/// Les fichiers listes par une reponse PROPFIND. Le dossier lui-meme (href terminee par /)
/// et les noms qu'un plugin ne peut pas ecrire sont ecartes.
fn analyser_liste(xml: &str) -> Vec<Fichier> {
    let mut fichiers = Vec::new();
    for bloc in xml.split("response>") {
        let Some(href) = valeur_xml(bloc, "href") else { continue };
        let chemin = depourcenter(href);
        if chemin.ends_with('/') {
            continue;
        }
        let nom = chemin.rsplit('/').next().unwrap_or(&chemin).to_string();
        let Some(version) = valeur_xml(bloc, "getetag") else { continue };
        if !is_safe_name(&nom) {
            continue;
        }
        let taille = valeur_xml(bloc, "getcontentlength").and_then(|t| t.parse().ok()).unwrap_or(0);
        fichiers.push(Fichier { nom, version: version.to_string(), taille });
    }
    fichiers
}

/// Supprime un fichier. Un fichier deja absent n'est pas une erreur : le but est qu'il
/// n'y soit plus (l'autre foyer a pu l'effacer entre-temps).
fn supprimer_distant(cible: &Cible, nom: &str) -> Result<(), Echec> {
    match envoyer(requete("DELETE", &format!("{}{nom}", cible.base), cible.auth.as_deref()), None)? {
        Ok(_) | Err(404) => Ok(()),
        Err(code) => Err(Echec::Erreur(format!("Nextcloud error {code} while deleting {nom}"))),
    }
}

/// Liste les fichiers de l'espace du plugin (PROPFIND Depth 1, un seul aller-retour).
fn lister_distant(cible: &Cible) -> Result<Vec<Fichier>, Echec> {
    const PROPS: &str = r#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/></d:prop></d:propfind>"#;
    let r = requete("PROPFIND", &cible.base, cible.auth.as_deref())
        .set("Depth", "1")
        .set("Content-Type", "application/xml");
    match envoyer(r, Some(PROPS.as_bytes()))? {
        Ok(reponse) => {
            let xml = reponse.into_string().map_err(|e| Echec::HorsLigne(e.to_string()))?;
            Ok(analyser_liste(&xml))
        }
        Err(404) => Err(Echec::Erreur("This sync folder no longer exists on Nextcloud".into())),
        Err(code) => Err(Echec::Erreur(format!("Nextcloud error {code} while listing the folder"))),
    }
}

/// Verifie que le dossier existe ; `creer` : cree les dossiers manquants (dossier du compte).
fn preparer_dossier(cible: &Cible, creer: bool) -> Result<(), Echec> {
    let existe = |url: &str| -> Result<bool, Echec> {
        match envoyer(requete("PROPFIND", url, cible.auth.as_deref()).set("Depth", "0"), None)? {
            Ok(_) => Ok(true),
            Err(404) => Ok(false),
            Err(code) => Err(Echec::Erreur(format!("Nextcloud error {code} on {url}"))),
        }
    };
    if existe(&cible.base)? {
        return Ok(());
    }
    if !creer {
        return Err(Echec::Erreur("This shared folder cannot be reached (link or password wrong?)".into()));
    }
    // Du plus haut au plus profond, a partir de la racine du compte (.../files/<utilisateur>/).
    const MARQUE: &str = "/remote.php/dav/files/";
    let inattendue = || Echec::Erreur("Unexpected folder address".into());
    let debut = cible.base.find(MARQUE).ok_or_else(inattendue)? + MARQUE.len();
    let apres_utilisateur = debut + cible.base[debut..].find('/').ok_or_else(inattendue)? + 1;
    let mut url = cible.base[..apres_utilisateur].to_string();
    for segment in cible.base[apres_utilisateur..].split('/').filter(|s| !s.is_empty()) {
        url.push_str(segment);
        url.push('/');
        if !existe(&url)? {
            match envoyer(requete("MKCOL", &url, cible.auth.as_deref()), None)? {
                Ok(_) | Err(405) => {} // 405 : cree entre-temps
                Err(code) => return Err(Echec::Erreur(format!("Could not create folder (error {code})"))),
            }
        }
    }
    Ok(())
}

// --- Reglages et copie hors ligne ---

fn fichier_reglages(app: &AppHandle) -> Result<PathBuf, String> {
    let dossier = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dossier).map_err(|e| format!("{}: {e}", dossier.display()))?;
    Ok(dossier.join("synchro.json"))
}

fn lire_reglages(chemin: &Path) -> Result<Reglages, String> {
    match std::fs::read_to_string(chemin) {
        Ok(texte) => serde_json::from_str(&texte).map_err(|e| format!("{}: {e}", chemin.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Reglages::default()),
        Err(e) => Err(format!("{}: {e}", chemin.display())),
    }
}

fn ecrire_reglages(chemin: &Path, reglages: &Reglages) -> Result<(), String> {
    let tmp = chemin.with_extension("tmp");
    let texte = serde_json::to_string_pretty(reglages).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, texte).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, chemin).map_err(|e| format!("{}: {e}", chemin.display()))
}

/// Derniere version connue de chaque fichier, pour la lecture hors ligne.
#[derive(Serialize, Deserialize)]
struct Copie {
    texte: String,
    version: String,
}

fn chemin_copie(app: &AppHandle, id: &str, nom: &str) -> Result<PathBuf, String> {
    let dossier = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("synchro").join(id);
    std::fs::create_dir_all(&dossier).map_err(|e| format!("{}: {e}", dossier.display()))?;
    Ok(dossier.join(format!("{nom}.json")))
}

/// Le cache n'est qu'un secours : un echec d'ecriture ne fait pas echouer la synchro.
fn garder_copie(app: &AppHandle, id: &str, nom: &str, copie: Option<&Copie>) {
    let Ok(chemin) = chemin_copie(app, id, nom) else { return };
    let resultat = match copie {
        Some(c) => serde_json::to_string(c).map_err(|e| e.to_string()).and_then(|t| std::fs::write(&chemin, t).map_err(|e| e.to_string())),
        None => match std::fs::remove_file(&chemin) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
    };
    if let Err(e) = resultat {
        eprintln!("Offline copy of {id}/{nom} not updated: {e}");
    }
}

fn cible_du_plugin(app: &AppHandle, id: &str) -> Result<Cible, String> {
    let reglages = lire_reglages(&fichier_reglages(app)?)?;
    let espace = reglages.espaces.get(id).ok_or("No sync folder chosen")?;
    cible(reglages.compte.as_ref(), espace)
}

fn verifier_noms(id: &str, nom: &str) -> Result<(), String> {
    if is_safe_name(id) && is_safe_name(nom) {
        Ok(())
    } else {
        Err("Invalid plugin or file name".into())
    }
}

// --- Commandes ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Etat {
    /// Compte connecte : "utilisateur@serveur".
    compte: Option<String>,
    /// Espace du plugin, sans mot de passe.
    espace: Option<serde_json::Value>,
    /// Vrai si la veille de ce plugin est active (notifications).
    veille: bool,
}

#[tauri::command]
pub fn sync_etat(app: AppHandle, id: String) -> Result<Etat, String> {
    let reglages = lire_reglages(&fichier_reglages(&app)?)?;
    let espace = reglages.espaces.get(&id).map(|e| match e {
        Espace::Compte { dossier } => serde_json::json!({ "mode": "compte", "dossier": dossier }),
        Espace::Lien { lien, .. } => serde_json::json!({ "mode": "lien", "lien": lien }),
    });
    let compte = reglages.compte.map(|c| format!("{}@{}", c.utilisateur, c.serveur.trim_start_matches("https://")));
    let veille = reglages.veilles.contains_key(&id);
    Ok(Etat { compte, espace, veille })
}

#[derive(Deserialize)]
struct Debut {
    poll: Sonde,
    login: String,
}

#[derive(Deserialize)]
struct Sonde {
    token: String,
    endpoint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identifiants {
    server: String,
    login_name: String,
    app_password: String,
}

/// Identifiant WebDAV de l'utilisateur (peut differer du nom de connexion, ex. e-mail).
fn identifiant_utilisateur(serveur: &str, auth: &str) -> Result<String, String> {
    let reponse = requete("GET", &format!("{serveur}/ocs/v2.php/cloud/user?format=json"), Some(auth))
        .set("OCS-APIRequest", "true")
        .call()
        .map_err(|e| format!("Could not read the Nextcloud user: {e}"))?;
    let json: serde_json::Value = json(reponse)?;
    json["ocs"]["data"]["id"].as_str().map(str::to_string).ok_or_else(|| "Nextcloud did not return the user id".into())
}

/// Connexion au compte : ouvre la page de connexion Nextcloud dans le navigateur et attend
/// l'autorisation (15 min max, ou `sync_annuler_connexion`). Renvoie "utilisateur@serveur".
#[tauri::command]
pub async fn sync_connecter(app: AppHandle, serveur: String) -> Result<String, String> {
    let serveur = verifier_serveur(&serveur)?;
    ANNULER_CONNEXION.store(false, Ordering::SeqCst);
    let debut: Debut = tauri::async_runtime::spawn_blocking({
        let url = format!("{serveur}/index.php/login/v2");
        move || -> Result<Debut, String> {
            let reponse = requete("POST", &url, None).call().map_err(|e| format!("This Nextcloud cannot be reached: {e}"))?;
            json(reponse).map_err(|e| format!("This address does not look like a Nextcloud: {e}"))
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&debut.login, None::<&str>).map_err(|e| format!("Could not open the browser: {e}"))?;

    let identifiants = tauri::async_runtime::spawn_blocking(move || -> Result<Identifiants, String> {
        let fin = std::time::Instant::now() + ATTENTE_CONNEXION;
        let mut erreur_reseau = None;
        while std::time::Instant::now() < fin {
            if ANNULER_CONNEXION.load(Ordering::SeqCst) {
                return Err("Connection cancelled".into());
            }
            match requete("POST", &debut.poll.endpoint, None).send_form(&[("token", &debut.poll.token)]) {
                Ok(reponse) => return json(reponse),
                Err(ureq::Error::Status(404, _)) => {} // pas encore autorise
                // Reseau coupe un moment : sur telephone, Android le retire a l'app passee en
                // arriere-plan pendant la connexion dans le navigateur. On reessaie.
                Err(ureq::Error::Transport(e)) => erreur_reseau = Some(e.to_string()),
                Err(e) => return Err(format!("Connection failed: {e}")),
            }
            std::thread::sleep(Duration::from_secs(2));
        }
        Err(match erreur_reseau {
            Some(e) => format!("Connection timed out (last network error: {e})"),
            None => "Connection timed out".into(),
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let serveur = verifier_serveur(&identifiants.server)?;
    let auth = basic(&identifiants.login_name, &identifiants.app_password);
    let utilisateur = tauri::async_runtime::spawn_blocking({
        let serveur = serveur.clone();
        move || identifiant_utilisateur(&serveur, &auth)
    })
    .await
    .map_err(|e| e.to_string())??;

    let chemin = fichier_reglages(&app)?;
    let mut reglages = lire_reglages(&chemin)?;
    reglages.compte = Some(Compte {
        serveur: serveur.clone(),
        utilisateur: utilisateur.clone(),
        connexion: identifiants.login_name,
        mot_de_passe: identifiants.app_password,
    });
    ecrire_reglages(&chemin, &reglages)?;
    Ok(format!("{utilisateur}@{}", serveur.trim_start_matches("https://")))
}

#[tauri::command]
pub fn sync_annuler_connexion() {
    ANNULER_CONNEXION.store(true, Ordering::SeqCst);
}

/// Oublie le compte et revoque son mot de passe d'application cote Nextcloud.
/// Les espaces en lien de partage restent utilisables.
#[tauri::command]
pub async fn sync_deconnecter(app: AppHandle) -> Result<(), String> {
    let chemin = fichier_reglages(&app)?;
    let mut reglages = lire_reglages(&chemin)?;
    let Some(compte) = reglages.compte.take() else { return Ok(()) };
    ecrire_reglages(&chemin, &reglages)?;
    // Revocation au mieux : hors ligne, le mot de passe reste listé dans Nextcloud (Securite).
    let revocation = tauri::async_runtime::spawn_blocking(move || {
        requete("DELETE", &format!("{}/ocs/v2.php/core/apppassword", compte.serveur), Some(&basic(&compte.connexion, &compte.mot_de_passe)))
            .set("OCS-APIRequest", "true")
            .call()
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    revocation.map_err(|e| format!("Disconnected, but the app password could not be revoked ({e}): remove it in Nextcloud, Settings > Security"))
}

/// Choisit l'espace d'un plugin, apres avoir verifie qu'il est joignable (un dossier du compte
/// manquant est cree).
#[tauri::command]
pub async fn sync_choisir(app: AppHandle, id: String, espace: Espace) -> Result<(), String> {
    if !is_safe_name(&id) {
        return Err("Invalid plugin name".into());
    }
    let chemin = fichier_reglages(&app)?;
    let mut reglages = lire_reglages(&chemin)?;
    let c = cible(reglages.compte.as_ref(), &espace)?;
    let creer = matches!(espace, Espace::Compte { .. });
    tauri::async_runtime::spawn_blocking(move || preparer_dossier(&c, creer))
        .await
        .map_err(|e| e.to_string())??;
    reglages.espaces.insert(id, espace);
    ecrire_reglages(&chemin, &reglages)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lu {
    texte: String,
    version: String,
    /// Vrai si Nextcloud est injoignable et que c'est la derniere copie connue.
    hors_ligne: bool,
}

/// Lit un fichier de l'espace du plugin ; None s'il n'existe pas.
#[tauri::command]
pub async fn sync_lire(app: AppHandle, id: String, nom: String) -> Result<Option<Lu>, String> {
    verifier_noms(&id, &nom)?;
    let c = cible_du_plugin(&app, &id)?;
    let n = nom.clone();
    let resultat = tauri::async_runtime::spawn_blocking(move || lire_distant(&c, &n)).await.map_err(|e| e.to_string())?;
    match resultat {
        Ok(Some((texte, version))) => {
            let copie = Copie { texte, version };
            garder_copie(&app, &id, &nom, Some(&copie));
            Ok(Some(Lu { texte: copie.texte, version: copie.version, hors_ligne: false }))
        }
        Ok(None) => {
            garder_copie(&app, &id, &nom, None);
            Ok(None)
        }
        Err(Echec::HorsLigne(detail)) => {
            let copie = std::fs::read_to_string(chemin_copie(&app, &id, &nom)?)
                .ok()
                .and_then(|t| serde_json::from_str::<Copie>(&t).ok())
                .ok_or_else(|| String::from(Echec::HorsLigne(detail)))?;
            Ok(Some(Lu { texte: copie.texte, version: copie.version, hors_ligne: true }))
        }
        Err(e) => Err(e.into()),
    }
}

/// Ecrit un fichier s'il est toujours a `version` (null : s'il n'existe pas encore).
/// Renvoie la nouvelle version, ou null en cas de conflit : relire puis recommencer.
#[tauri::command]
pub async fn sync_ecrire(app: AppHandle, id: String, nom: String, texte: String, version: Option<String>) -> Result<Option<String>, String> {
    verifier_noms(&id, &nom)?;
    let c = cible_du_plugin(&app, &id)?;
    let (n, t) = (nom.clone(), texte.clone());
    let nouvelle = tauri::async_runtime::spawn_blocking(move || ecrire_distant(&c, &n, &t, version.as_deref()))
        .await
        .map_err(|e| e.to_string())??;
    if let Some(v) = &nouvelle {
        garder_copie(&app, &id, &nom, Some(&Copie { texte, version: v.clone() }));
    }
    Ok(nouvelle)
}

/// Liste les fichiers de l'espace du plugin. Pas de copie hors ligne : hors ligne, un plugin
/// qui a besoin de la liste garde la sienne (les fichiers lus, eux, restent en cache).
#[tauri::command]
pub async fn sync_lister(app: AppHandle, id: String) -> Result<Vec<Fichier>, String> {
    if !is_safe_name(&id) {
        return Err("Invalid plugin name".into());
    }
    let c = cible_du_plugin(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || lister_distant(&c)).await.map_err(|e| e.to_string())?.map_err(Into::into)
}

/// Supprime un fichier de l'espace du plugin, et sa copie hors ligne. Sans effet s'il
/// n'existe plus : seul compte le fait qu'il ne soit plus la.
#[tauri::command]
pub async fn sync_supprimer(app: AppHandle, id: String, nom: String) -> Result<(), String> {
    verifier_noms(&id, &nom)?;
    let c = cible_du_plugin(&app, &id)?;
    let n = nom.clone();
    tauri::async_runtime::spawn_blocking(move || supprimer_distant(&c, &n)).await.map_err(|e| e.to_string())??;
    garder_copie(&app, &id, &nom, None);
    Ok(())
}

/// Lit un fichier binaire (photo...), rendu en base64 : l'IPC reste simple et Nextcloud
/// recoit les vrais octets, donc le fichier y reste visible tel quel. Pas de cache hors ligne.
#[tauri::command]
pub async fn sync_lire_octets(app: AppHandle, id: String, nom: String) -> Result<Option<String>, String> {
    verifier_noms(&id, &nom)?;
    let c = cible_du_plugin(&app, &id)?;
    let lu = tauri::async_runtime::spawn_blocking(move || lire_octets_distant(&c, &nom)).await.map_err(|e| e.to_string())??;
    Ok(lu.map(|(octets, _)| base64(&octets)))
}

/// Ecrit un fichier binaire recu en base64. Comme `sync_ecrire` : `version` null cree un
/// fichier qui n'existe pas encore, et null en retour signale un conflit.
#[tauri::command]
pub async fn sync_ecrire_octets(
    app: AppHandle,
    id: String,
    nom: String,
    contenu: String,
    version: Option<String>,
) -> Result<Option<String>, String> {
    verifier_noms(&id, &nom)?;
    let c = cible_du_plugin(&app, &id)?;
    let octets = debase64(&contenu)?;
    tauri::async_runtime::spawn_blocking(move || ecrire_octets_distant(&c, &nom, &octets, version.as_deref()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

// --- Veille : prevenir quand l'autre appareil depose quelque chose ---
//
// L'ecran d'un plugin n'est monte que lorsqu'on le regarde : la veille vit donc ici, et
// tourne tant que le hub tourne (sur le bureau, meme reduit dans la zone de notification ;
// sur Android, tant que l'application n'est pas fermee par le systeme). Un seul PROPFIND
// par espace surveille et par tour, rien n'est telecharge.

/// Delai entre deux tours de veille.
const VEILLE: Duration = Duration::from_secs(5 * 60);

fn fichier_vus(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dossier = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("synchro");
    std::fs::create_dir_all(&dossier).map_err(|e| format!("{}: {e}", dossier.display()))?;
    Ok(dossier.join(format!("{id}.vus.json")))
}

/// Un tour pour un plugin : les fichiers apparus depuis le tour precedent.
/// None au tout premier tour : on note ce qui existe deja sans rien annoncer.
fn nouveautes(app: &AppHandle, id: &str, v: &Veille) -> Result<Option<usize>, String> {
    let cible = cible_du_plugin(app, id)?;
    let presents: Vec<String> = lister_distant(&cible)
        .map_err(String::from)?
        .into_iter()
        .filter(|f| f.nom.starts_with(&v.prefixe))
        .map(|f| f.nom)
        .collect();
    let chemin = fichier_vus(app, id)?;
    let connus: Option<Vec<String>> = std::fs::read_to_string(&chemin).ok().and_then(|t| serde_json::from_str(&t).ok());
    let texte = serde_json::to_string(&presents).map_err(|e| e.to_string())?;
    std::fs::write(&chemin, texte).map_err(|e| format!("{}: {e}", chemin.display()))?;
    Ok(connus.map(|connus| presents.iter().filter(|nom| !connus.contains(nom)).count()))
}

/// Lance la veille pour la duree de vie de l'application.
pub fn demarrer_veille(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(VEILLE);
        let Ok(chemin) = fichier_reglages(&app) else { continue };
        let Ok(reglages) = lire_reglages(&chemin) else { continue };
        for (id, v) in &reglages.veilles {
            match nouveautes(&app, id, v) {
                Ok(Some(n)) if n > 0 => {
                    use tauri_plugin_notification::NotificationExt;
                    let corps = v.message.replace("{n}", &n.to_string());
                    if let Err(e) = app.notification().builder().title(&v.titre).body(corps).show() {
                        eprintln!("Notification for {id} not shown: {e}");
                    }
                }
                Ok(_) => {}
                // Nextcloud injoignable ou espace efface : on reessaiera au tour suivant.
                Err(e) => eprintln!("Watch on {id}: {e}"),
            }
        }
    });
}

/// Active ou coupe la veille d'un plugin. A l'activation, l'etat courant du dossier est
/// note tout de suite : seules les nouveautes ulterieures sont annoncees.
#[tauri::command]
pub async fn sync_veille(
    app: AppHandle,
    id: String,
    titre: String,
    message: String,
    prefixe: String,
    actif: bool,
) -> Result<(), String> {
    if !is_safe_name(&id) {
        return Err("Invalid plugin name".into());
    }
    let chemin = fichier_reglages(&app)?;
    let mut reglages = lire_reglages(&chemin)?;
    if actif {
        let v = Veille { titre, message, prefixe };
        let (a, i, veille) = (app.clone(), id.clone(), v.clone());
        tauri::async_runtime::spawn_blocking(move || nouveautes(&a, &i, &veille)).await.map_err(|e| e.to_string())??;
        reglages.veilles.insert(id, v);
    } else {
        reglages.veilles.remove(&id);
        if let Ok(chemin) = fichier_vus(&app, &id) {
            let _ = std::fs::remove_file(chemin);
        }
    }
    ecrire_reglages(&chemin, &reglages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::sync::{Arc, Mutex};

    #[test]
    fn base64_conforme() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"user:p@ss"), "dXNlcjpwQHNz");
    }

    #[test]
    fn base64_aller_retour() {
        assert_eq!(debase64("").unwrap(), b"");
        for source in [&b"f"[..], b"fo", b"foo", b"\x00\xff\x10photo"] {
            assert_eq!(debase64(&base64(source)).unwrap(), source);
        }
        assert!(debase64("ab*d").is_err());
    }

    /// Reponse PROPFIND Depth 1 de Nextcloud : le dossier lui-meme, puis ses fichiers.
    #[test]
    fn liste_d_un_dossier() {
        let xml = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/remote.php/dav/files/tom/ExziHub/Carnet%20%C3%A9/</d:href>
            <d:propstat><d:prop><d:getetag>&quot;dossier&quot;</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
          <d:response><d:href>/remote.php/dav/files/tom/ExziHub/Carnet%20%C3%A9/e-123.json</d:href>
            <d:propstat><d:prop><d:getetag>"abc"</d:getetag><d:getcontentlength>42</d:getcontentlength></d:prop></d:propstat></d:response>
          <d:response><d:href>/remote.php/dav/files/tom/ExziHub/Carnet%20%C3%A9/p-123-1.jpg</d:href>
            <d:propstat><d:prop><d:getetag>"def"</d:getetag><d:getcontentlength>310244</d:getcontentlength></d:prop></d:propstat></d:response>
          <d:response><d:href>/remote.php/dav/files/tom/ExziHub/Carnet%20%C3%A9/pas%20propre.json</d:href>
            <d:propstat><d:prop><d:getetag>"ghi"</d:getetag></d:prop></d:propstat></d:response>
        </d:multistatus>"#;
        assert_eq!(
            analyser_liste(xml),
            vec![
                Fichier { nom: "e-123.json".into(), version: "\"abc\"".into(), taille: 42 },
                Fichier { nom: "p-123-1.jpg".into(), version: "\"def\"".into(), taille: 310244 },
            ]
        );
    }

    #[test]
    fn adresses_du_compte_et_du_lien() {
        let compte = Compte {
            serveur: "https://cloud.ex.fr".into(),
            utilisateur: "tom r".into(),
            connexion: "tom".into(),
            mot_de_passe: "mdp".into(),
        };
        let c = cible(Some(&compte), &Espace::Compte { dossier: "/Famille/Courbe é/".into() }).unwrap();
        assert_eq!(c.base, "https://cloud.ex.fr/remote.php/dav/files/tom%20r/Famille/Courbe%20%C3%A9/");
        assert_eq!(c.auth.as_deref(), Some("Basic dG9tOm1kcA=="));

        let lien = Espace::Lien { lien: "https://cloud.ex.fr/index.php/s/AbC123/".into(), mot_de_passe: String::new() };
        assert_eq!(cible(None, &lien).unwrap(), Cible { base: "https://cloud.ex.fr/public.php/dav/files/AbC123/".into(), auth: None });
        let lien = Espace::Lien { lien: "https://cloud.ex.fr/s/AbC123".into(), mot_de_passe: "x".into() };
        assert_eq!(cible(None, &lien).unwrap().auth.as_deref(), Some("Basic YW5vbnltb3VzOng="));
    }

    #[test]
    fn entrees_refusees() {
        assert!(verifier_serveur("http://cloud.ex.fr").is_err());
        assert!(verifier_serveur("https://").is_err());
        // Adresse copiee depuis le navigateur, installation a la racine ou dans un sous-dossier.
        assert_eq!(verifier_serveur("https://cloud.ex.fr/index.php/apps/files").unwrap(), "https://cloud.ex.fr");
        assert_eq!(verifier_serveur(" https://cloud.ex.fr/settings/user?tab=1 ").unwrap(), "https://cloud.ex.fr");
        assert_eq!(verifier_serveur("https://h.fr/nextcloud/apps/dashboard").unwrap(), "https://h.fr/nextcloud");
        assert_eq!(verifier_serveur("https://cloud.ex.fr/").unwrap(), "https://cloud.ex.fr");
        assert!(analyser_lien("https://cloud.ex.fr/f/123").is_err());
        assert!(analyser_lien("https://cloud.ex.fr/s/ab/../x").is_err());
        assert!(segments_dossier("a/../b").is_err());
        assert!(segments_dossier(" / ").is_err());
        assert!(cible(None, &Espace::Compte { dossier: "a".into() }).is_err());
    }

    /// Chemin -> (contenu, numero de version).
    type Fichiers = Arc<Mutex<HashMap<String, (String, u32)>>>;

    /// Serveur WebDAV minimal : GET, PUT (If-Match / If-None-Match), PROPFIND, MKCOL.
    fn serveur_webdav(auth_attendue: &'static str) -> (String, Fichiers) {
        let fichiers = Fichiers::default();
        let partage = fichiers.clone();
        let ecoute = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", ecoute.local_addr().unwrap());
        std::thread::spawn(move || {
            for flux in ecoute.incoming().flatten() {
                let mut lecteur = BufReader::new(flux.try_clone().unwrap());
                let mut ligne = String::new();
                lecteur.read_line(&mut ligne).unwrap();
                let mut morceaux = ligne.split_whitespace();
                let (methode, chemin) = (morceaux.next().unwrap().to_string(), morceaux.next().unwrap().to_string());
                let mut entetes = HashMap::new();
                loop {
                    let mut l = String::new();
                    lecteur.read_line(&mut l).unwrap();
                    if l.trim().is_empty() {
                        break;
                    }
                    let (k, v) = l.split_once(':').unwrap();
                    entetes.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
                }
                let longueur: usize = entetes.get("content-length").map_or(0, |v| v.parse().unwrap());
                let mut corps = vec![0; longueur];
                lecteur.read_exact(&mut corps).unwrap();
                let mut fichiers = partage.lock().unwrap();
                let (code, etag, texte, gzip) = if entetes.get("authorization").map(String::as_str) != Some(auth_attendue) {
                    (401, None, String::new(), false)
                } else {
                    match methode.as_str() {
                        "GET" => match fichiers.get(&chemin) {
                            // Comme Apache avec mod_deflate : ETag suffixe si le client accepte gzip.
                            Some((t, v)) => {
                                let gzip = entetes.get("accept-encoding").is_some_and(|a| a.contains("gzip"));
                                (200, Some(format!("\"v{v}\"")), t.clone(), gzip)
                            }
                            None => (404, None, String::new(), false),
                        },
                        "PUT" => {
                            let actuel = fichiers.get(&chemin).map(|(_, v)| format!("\"v{v}\""));
                            let accepte = match (entetes.get("if-match"), entetes.get("if-none-match")) {
                                (Some(m), _) => actuel.as_ref() == Some(m),
                                (None, Some(_)) => actuel.is_none(),
                                (None, None) => true,
                            };
                            if accepte {
                                let v = fichiers.get(&chemin).map_or(1, |(_, v)| v + 1);
                                fichiers.insert(chemin.clone(), (String::from_utf8(corps).unwrap(), v));
                                (201, Some(format!("\"v{v}\"")), String::new(), false)
                            } else {
                                (412, None, String::new(), false)
                            }
                        }
                        "DELETE" => (if fichiers.remove(&chemin).is_some() { 204 } else { 404 }, None, String::new(), false),
                        "PROPFIND" => (if fichiers.contains_key(&chemin) { 207 } else { 404 }, None, String::new(), false),
                        "MKCOL" => {
                            fichiers.insert(chemin.clone(), (String::new(), 0));
                            (201, None, String::new(), false)
                        }
                        _ => (405, None, String::new(), false),
                    }
                };
                let mut reponse = format!("HTTP/1.1 {code} X\r\nContent-Length: {}\r\nConnection: close\r\n", texte.len());
                if let Some(e) = etag {
                    let suffixe = if gzip { "-gzip" } else { "" };
                    reponse.push_str(&format!("ETag: {}{suffixe}\"\r\nOC-ETag: {e}\r\n", e.trim_end_matches('"')));
                }
                reponse.push_str("\r\n");
                reponse.push_str(&texte);
                let mut flux = flux;
                let _ = flux.write_all(reponse.as_bytes());
            }
        });
        (base, fichiers)
    }

    #[test]
    fn ecritures_conditionnelles_conflit_et_dossiers() {
        let auth = "Basic dG9tOm1kcA=="; // tom:mdp
        let (base, fichiers) = serveur_webdav(auth);
        fichiers.lock().unwrap().insert("/remote.php/dav/files/tom/".into(), (String::new(), 0));
        let compte = Compte { serveur: base.clone(), utilisateur: "tom".into(), connexion: "tom".into(), mot_de_passe: "mdp".into() };
        let c = cible(Some(&compte), &Espace::Compte { dossier: "ExziHub/Budget".into() }).unwrap();

        // Dossiers crees un par un depuis la racine du compte.
        preparer_dossier(&c, true).unwrap();
        assert!(fichiers.lock().unwrap().contains_key("/remote.php/dav/files/tom/ExziHub/Budget/"));

        // Creation, puis une deuxieme creation du meme fichier est un conflit.
        assert!(lire_distant(&c, "b.json").unwrap().is_none());
        let v1 = ecrire_distant(&c, "b.json", "un", None).unwrap().unwrap();
        assert_eq!(ecrire_distant(&c, "b.json", "autre", None).unwrap(), None);

        // Modification de la version lue ; l'ancienne version est refusee.
        let v2 = ecrire_distant(&c, "b.json", "deux", Some(&v1)).unwrap().unwrap();
        assert_eq!(ecrire_distant(&c, "b.json", "trois", Some(&v1)).unwrap(), None);
        assert_eq!(lire_distant(&c, "b.json").unwrap(), Some(("deux".into(), v2)));

        // Regression : la version relue (ETag "-gzip" cote Apache) doit permettre d'ecrire.
        let (_, lue) = lire_distant(&c, "b.json").unwrap().unwrap();
        assert!(ecrire_distant(&c, "b.json", "quatre", Some(&lue)).unwrap().is_some());

        // Suppression : le fichier disparait, et reeffacer ne fait pas echouer.
        supprimer_distant(&c, "b.json").unwrap();
        assert!(lire_distant(&c, "b.json").unwrap().is_none());
        supprimer_distant(&c, "b.json").unwrap();

        // Mauvais identifiants : erreur explicite, pas de repli hors ligne.
        let intrus = Cible { base: c.base.clone(), auth: Some(basic("tom", "faux")) };
        assert!(matches!(lire_distant(&intrus, "b.json"), Err(Echec::Erreur(m)) if m.contains("credentials")));
        // Lien de partage introuvable : pas de creation de dossier.
        let lien = Cible { base: format!("{base}/public.php/dav/files/Abc/"), auth: Some(auth.into()) };
        assert!(preparer_dossier(&lien, false).is_err());
    }

    #[test]
    fn serveur_injoignable_est_hors_ligne() {
        // Port ferme : l'ecoute est liberee aussitot.
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let c = Cible { base: format!("http://127.0.0.1:{port}/"), auth: None };
        assert!(matches!(lire_distant(&c, "x.json"), Err(Echec::HorsLigne(_))));
        assert!(matches!(ecrire_distant(&c, "x.json", "t", None), Err(Echec::HorsLigne(_))));
    }
}
