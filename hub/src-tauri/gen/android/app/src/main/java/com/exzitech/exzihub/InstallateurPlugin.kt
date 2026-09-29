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
class InstallerArgs {
    lateinit var chemin: String
}

/**
 * Ouvre l'installeur d'Android sur un APK du cache de l'app (mise a jour, voir maj_apk.rs).
 * Android demande confirmation, et la premiere fois d'autoriser ExziHub a installer des apps.
 */
@TauriPlugin
class InstallateurPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun installer(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallerArgs::class.java)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", File(args.chemin))
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            invoke.resolve()
        } catch (ex: Exception) {
            invoke.reject(ex.message)
        }
    }
}
