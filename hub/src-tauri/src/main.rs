// Pas de console noire derriere la fenetre en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    exzihub_lib::run()
}
