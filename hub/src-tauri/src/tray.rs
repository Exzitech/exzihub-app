//! Icone de la zone de notification : garde le hub (et la veille des espaces synchronises)
//! actif quand sa fenetre est fermee. « Quitter » de son menu arrete vraiment le hub.
//!
//! Fermer la fenetre principale ne quitte pas d'office : le hub demande s'il doit rester en
//! arriere-plan (bouton « Garder », « Quitter » ou « Annuler »). La case « ne plus demander »
//! du menu de l'icone memorise le choix « garder » (reglages.rs : %APPDATA%\ExziHub\hub\fermeture.txt).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

use crate::reglages;

/// Vrai une fois l'icone creee : fermer la fenetre principale ne quitte alors plus d'office.
/// Sans icone, fermer quitte comme avant (sinon le hub serait inatteignable).
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// Une seule question a la fois, meme si l'utilisateur clique plusieurs fois sur la croix.
static QUESTION_OUVERTE: AtomicBool = AtomicBool::new(false);

const REGLAGE: &str = "fermeture.txt";
const EN_ARRIERE_PLAN: &str = "background";
const GARDER: &str = "Keep in background";
const QUITTER: &str = "Quit";
const ANNULER: &str = "Cancel";

const REGLAGES: &str = "hub";

/// Vrai si le reglage demande de ne plus poser la question (garder en arriere-plan).
fn garder_depuis(texte: Option<&str>) -> bool {
    texte.is_some_and(|t| t.trim() == EN_ARRIERE_PLAN)
}

fn garder_sans_demander() -> bool {
    garder_depuis(reglages::lire(REGLAGES, REGLAGE).as_deref())
}

fn memoriser(garder: bool) -> Result<(), String> {
    if garder {
        reglages::ecrire(REGLAGES, REGLAGE, EN_ARRIERE_PLAN)
    } else {
        reglages::retirer(REGLAGES, REGLAGE)
    }
}

/// Ramene la fenetre principale (masquee dans la zone de notification, ou derriere d'autres).
pub fn afficher_hub(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn creer(app: &AppHandle) -> tauri::Result<()> {
    let hub = MenuItem::with_id(app, "hub", "Open ExziHub", true, None::<&str>)?;
    let separateur = PredefinedMenuItem::separator(app)?;
    let silence = CheckMenuItem::with_id(app, "silence", "Closing the window keeps ExziHub running (don't ask)", true, garder_sans_demander(), None::<&str>)?;
    let quitter = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&hub, &separateur, &silence, &quitter])?;
    let icone = app.default_window_icon().cloned().ok_or_else(|| tauri::Error::AssetNotFound("window icon".into()))?;

    let case = silence.clone();
    TrayIconBuilder::new()
        .icon(icone)
        .tooltip("ExziHub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, evenement| match evenement.id.as_ref() {
            "hub" => afficher_hub(app),
            "silence" => {
                // La case est deja basculee quand l'evenement arrive.
                let garder = case.is_checked().unwrap_or(false);
                if let Err(e) = memoriser(garder) {
                    eprintln!("Closing preference not saved: {e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, evenement| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evenement {
                afficher_hub(tray.app_handle());
            }
        })
        .build(app)?;
    ACTIVE.store(true, Ordering::Relaxed);
    Ok(())
}

/// Question posee a la fermeture : garder en arriere-plan, quitter, ou annuler (la fenetre reste).
fn demander(fenetre: Window) {
    if QUESTION_OUVERTE.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = fenetre.app_handle().clone();
    app.dialog()
        .message("Keep ExziHub running in the background?\n\nSync notifications only arrive while it runs. You can bring it back from the icon near the clock.")
        .title("Close ExziHub")
        .buttons(MessageDialogButtons::YesNoCancelCustom(GARDER.into(), QUITTER.into(), ANNULER.into()))
        .show_with_result(move |reponse| {
            QUESTION_OUVERTE.store(false, Ordering::Relaxed);
            match reponse {
                MessageDialogResult::Custom(bouton) if bouton == GARDER => {
                    let _ = fenetre.hide();
                }
                MessageDialogResult::Custom(bouton) if bouton == QUITTER => fenetre.app_handle().exit(0),
                _ => {} // annule (ou boite fermee) : la fenetre reste ouverte
            }
        });
}

/// Fermer la fenetre principale : selon le reglage, on la masque ou on demande d'abord.
pub fn fenetre_evenement(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && ACTIVE.load(Ordering::Relaxed) {
            api.prevent_close();
            if garder_sans_demander() {
                let _ = window.hide();
            } else {
                demander(window.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reglage_de_fermeture() {
        assert!(!garder_depuis(None), "sans reglage : on demande");
        assert!(garder_depuis(Some("background")));
        assert!(garder_depuis(Some("background\r\n")));
        assert!(!garder_depuis(Some("n'importe quoi")), "valeur inconnue : on demande");
        assert!(!garder_depuis(Some("")));
    }
}
