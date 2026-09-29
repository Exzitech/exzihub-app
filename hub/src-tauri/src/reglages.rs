//! Reglages du hub qui doivent survivre a sa desinstallation et a sa reinstallation
//! (preference de fermeture).
//!
//! Ils vivent dans %APPDATA%\ExziHub\<id>\, hors du dossier du hub que la desinstallation
//! efface. Par compatibilite, un reglage absent de ce dossier est lu dans l'ancien emplacement
//! (donnees/<id>/) ; il migre au premier enregistrement. Rien de secret ici : des chemins et des
//! preferences.

use std::path::{Path, PathBuf};

/// %APPDATA%\ExziHub\<id>\, cree au besoin.
fn dossier_persistant(id: &str) -> Option<PathBuf> {
    let dossier = PathBuf::from(std::env::var_os("APPDATA")?).join("ExziHub").join(id);
    std::fs::create_dir_all(&dossier).ok()?;
    Some(dossier)
}

/// Dossiers ou chercher un reglage, par ordre de priorite : le nouveau, puis l'ancien.
fn dossiers_de_lecture(id: &str) -> Vec<PathBuf> {
    [dossier_persistant(id), crate::donnees_dir(id)].into_iter().flatten().collect()
}

fn lire_dans(dossiers: &[PathBuf], nom: &str) -> Option<String> {
    dossiers.iter().find_map(|d| std::fs::read_to_string(d.join(nom)).ok())
}

fn ecrire_dans(dossier: &Path, nom: &str, contenu: &str) -> Result<(), String> {
    let f = dossier.join(nom);
    std::fs::write(&f, contenu).map_err(|e| format!("{}: {e}", f.display()))
}

/// Retire le reglage de tous les emplacements (sinon l'ancien reapparaitrait a la lecture).
fn retirer_dans(dossiers: &[PathBuf], nom: &str) -> Result<(), String> {
    for d in dossiers {
        let f = d.join(nom);
        match std::fs::remove_file(&f) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("{}: {e}", f.display())),
        }
    }
    Ok(())
}

pub fn lire(id: &str, nom: &str) -> Option<String> {
    lire_dans(&dossiers_de_lecture(id), nom)
}

pub fn ecrire(id: &str, nom: &str, contenu: &str) -> Result<(), String> {
    let dossier = dossier_persistant(id).or_else(|| crate::donnees_dir(id)).ok_or("Settings folder not found")?;
    ecrire_dans(&dossier, nom, contenu)
}

pub fn retirer(id: &str, nom: &str) -> Result<(), String> {
    retirer_dans(&dossiers_de_lecture(id), nom)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dossier(nom: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("exzihub-reglages-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn le_nouvel_emplacement_prime_sur_l_ancien() {
        let (nouveau, ancien) = (dossier("nouveau"), dossier("ancien"));
        ecrire_dans(&ancien, "a.txt", "ancien").unwrap();
        // Seul l'ancien existe : migration, on le lit.
        assert_eq!(lire_dans(&[nouveau.clone(), ancien.clone()], "a.txt").as_deref(), Some("ancien"));
        ecrire_dans(&nouveau, "a.txt", "nouveau").unwrap();
        assert_eq!(lire_dans(&[nouveau, ancien], "a.txt").as_deref(), Some("nouveau"));
    }

    #[test]
    fn reglage_absent() {
        assert_eq!(lire_dans(&[dossier("vide")], "inconnu.txt"), None);
    }

    #[test]
    fn retirer_efface_partout_et_tolere_l_absence() {
        let (nouveau, ancien) = (dossier("r-nouveau"), dossier("r-ancien"));
        ecrire_dans(&nouveau, "a.txt", "1").unwrap();
        ecrire_dans(&ancien, "a.txt", "2").unwrap();
        let tous = [nouveau, ancien];
        retirer_dans(&tous, "a.txt").unwrap();
        assert_eq!(lire_dans(&tous, "a.txt"), None, "l'ancien ne doit pas reapparaitre");
        retirer_dans(&tous, "a.txt").unwrap(); // deja retire : sans erreur
    }
}
