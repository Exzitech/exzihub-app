package com.exzitech.exzihub

import android.app.Activity
import android.content.Intent
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class PartagerArgs {
    lateinit var chemin: String
    lateinit var type: String
}

/**
 * Menu de partage d'Android sur un fichier du cache de l'app (voir partage.rs) : c'est ce qui
 * remplace "Enregistrer sous" du bureau, l'utilisateur choisissant Fichiers, Drive, un message...
 * Aucune permission de stockage : le fichier est pret via le FileProvider, comme pour l'APK.
 */
@TauriPlugin
class PartagePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun partager(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PartagerArgs::class.java)
            val fichier = File(args.chemin)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", fichier)
            val envoi = Intent(Intent.ACTION_SEND)
                .setType(args.type)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(Intent.createChooser(envoi, fichier.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message)
        }
    }
}
