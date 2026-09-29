//! Moteurs des outils (backends Python) : lancement, arret, dependances pip.
//! Bureau Windows uniquement : un telephone ne lance pas de processus Python.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::State;

use crate::{donnees_dir, hub_file, is_safe_name, plugins_dir, tools_path};

/// Pas de fenetre console pour les backends lances : l'OCR de Coût des plats
/// relirait ses lignes de log comme des achats.
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Deserialize)]
struct Launch {
    /// "python" et "pythonw" sont resolus via hub.local.json (voir `python_exe`) :
    /// un plugin ne connait pas le chemin de Python sur la machine.
    command: String,
    #[serde(default)]
    args: Vec<String>,
    /// Relatif au dossier de tools.json, ou a plugins/<id>/ pour un plugin.
    #[serde(default)]
    cwd: Option<String>,
}

/// Surcharge propre a la machine (tools.local.json, non versionne), ecrite par
/// l'installeur : typiquement le chemin absolu de pythonw, que le PATH du
/// Bureau ne connait pas encore juste apres l'installation de Python.
#[derive(Deserialize, Default)]
struct LaunchOverride {
    command: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct ToolEntry {
    id: String,
    launch: Option<Launch>,
}

/// Backends lances par le hub, par id d'outil.
#[derive(Default)]
pub struct Processes(pub Mutex<HashMap<String, Child>>);

/// Chemin de Python sur cette machine, ecrit par l'installeur dans
/// hub.local.json (non versionne) : `{ "python": "C:\\Python314\\python.exe" }`.
///
/// Le PATH du Bureau ne connait pas toujours Python juste apres son
/// installation, et un plugin ne peut pas deviner ce chemin. `pythonw` est
/// deduit du voisin : il lance un moteur sans fenetre console (une console
/// afficherait ses logs, que l'OCR relirait comme des achats).
fn python_exe(windowless: bool) -> Option<PathBuf> {
    #[derive(Deserialize)]
    struct HubLocal {
        python: Option<String>,
    }
    let raw = std::fs::read_to_string(hub_file("hub.local.json")?).ok()?;
    let config: HubLocal = serde_json::from_str(&raw).ok()?;
    let python = PathBuf::from(config.python?);
    if !windowless {
        return Some(python);
    }
    let sibling = python.with_file_name("pythonw.exe");
    Some(if sibling.is_file() { sibling } else { python })
}

/// Remplace "python"/"pythonw" par le chemin de la machine, s'il est connu.
fn resolve_command(command: String) -> String {
    match command.as_str() {
        "python" | "python.exe" => python_exe(false),
        "pythonw" | "pythonw.exe" => python_exe(true),
        _ => None,
    }
    .map_or(command, |p| p.to_string_lossy().into_owned())
}

/// Installe les dependances Python du plugin, s'il en declare (requirements.txt
/// a sa racine). Un plugin a moteur embarque ce dont il a besoin ; sans ca, il
/// faudrait relancer l'installeur du hub pour chaque nouvelle bibliotheque.
pub fn install_requirements(dir: &Path) -> Result<(), String> {
    let requirements = dir.join("requirements.txt");
    if !requirements.is_file() {
        return Ok(());
    }
    // python.exe et non pythonw : on veut lire la sortie de pip en cas d'echec.
    let python = python_exe(false).unwrap_or_else(|| PathBuf::from("python"));
    let out = Command::new(&python)
        .args(["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r"])
        .arg(&requirements)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Python is required by this plugin but could not be run ({}): {e}", python.display()))?;
    if out.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&out.stderr);
    Err(format!("Could not install this plugin's Python dependencies: {}", detail.trim()))
}

/// Le "launch" d'un outil integre (tools.json), avec le dossier auquel son
/// `cwd` est relatif.
fn launch_from_tools(id: &str) -> Result<Option<(Launch, PathBuf)>, String> {
    let Some(path) = tools_path() else { return Ok(None) };
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let tools: Vec<ToolEntry> = serde_json::from_str(&raw).map_err(|e| format!("tools.json invalide : {e}"))?;
    let base = path.parent().unwrap_or(Path::new(".")).to_path_buf();
    Ok(tools.into_iter().find(|t| t.id == id).and_then(|t| t.launch).map(|l| (l, base)))
}

/// Le "launch" d'un plugin (plugins/<id>/manifest.json). Son `cwd` est relatif
/// a son propre dossier : un plugin ignore ou il est installe.
fn launch_from_plugin(id: &str) -> Result<Option<(Launch, PathBuf)>, String> {
    #[derive(Deserialize)]
    struct PluginEntry {
        launch: Option<Launch>,
    }
    let Some(dir) = plugins_dir().map(|d| d.join(id)) else { return Ok(None) };
    let Ok(raw) = std::fs::read_to_string(dir.join("manifest.json")) else { return Ok(None) };
    let entry: PluginEntry =
        serde_json::from_str(&raw).map_err(|e| format!("manifest.json de {id} invalide : {e}"))?;
    Ok(entry.launch.map(|l| (l, dir)))
}

/// La commande est relue sur disque cote Rust (tools.json, sinon le manifest du
/// plugin) : la webview ne peut demander que le lancement d'un outil declare,
/// jamais une commande arbitraire.
#[tauri::command]
pub fn start_tool(id: String, processes: State<Processes>) -> Result<(), String> {
    let mut map = processes.0.lock().unwrap();
    if let Some(child) = map.get_mut(&id) {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(()); // deja lance
        }
    }

    if !is_safe_name(&id) {
        return Err("Nom d'outil invalide".into());
    }
    let (mut launch, base) = match launch_from_tools(&id)? {
        Some(found) => found,
        None => launch_from_plugin(&id)?
            .ok_or_else(|| format!("Pas de \"launch\" pour l'outil {id}"))?,
    };

    // Les surcharges restent celles du hub : tools.local.json est a cote de tools.json.
    let hub = tools_path().and_then(|p| p.parent().map(PathBuf::from)).unwrap_or_else(|| base.clone());
    if let Ok(raw) = std::fs::read_to_string(hub.join("tools.local.json")) {
        let mut overrides: HashMap<String, LaunchOverride> =
            serde_json::from_str(&raw).map_err(|e| format!("tools.local.json invalide : {e}"))?;
        let local = overrides.remove(&id).unwrap_or_default();
        launch.command = local.command.unwrap_or(launch.command);
        launch.args = local.args.unwrap_or(launch.args);
        launch.cwd = local.cwd.or(launch.cwd);
    }

    launch.command = resolve_command(launch.command);
    let cwd = launch.cwd.as_deref().map_or_else(|| base.clone(), |c| base.join(c));

    let mut commande = Command::new(&launch.command);
    commande.args(&launch.args).current_dir(&cwd);
    // Ou le moteur ecrit ce qui doit survivre a une mise a jour (voir donnees_dir).
    if let Some(donnees) = donnees_dir(&id) {
        commande.env("EXZIHUB_DONNEES", &donnees);
    }
    let child = commande
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Impossible de lancer « {} » dans {} : {e}", launch.command, cwd.display()))?;
    map.insert(id, child);
    Ok(())
}

/// Tue le processus ET ses enfants (threads OCR, sous-processus eventuels).
pub fn kill_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn stop_tool(id: String, processes: State<Processes>) {
    if let Some(mut child) = processes.0.lock().unwrap().remove(&id) {
        kill_tree(&mut child);
    }
}

/// true si le hub a lance ce backend et qu'il tourne encore (fermer la fenetre
/// Python a la main le fait repasser a false).
#[tauri::command]
pub fn tool_running(id: String, processes: State<Processes>) -> bool {
    let mut map = processes.0.lock().unwrap();
    match map.get_mut(&id).map(|c| c.try_wait()) {
        Some(Ok(None)) => true,
        Some(_) => {
            map.remove(&id);
            false
        }
        None => false,
    }
}
