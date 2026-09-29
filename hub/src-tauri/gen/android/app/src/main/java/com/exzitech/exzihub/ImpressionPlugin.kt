package com.exzitech.exzihub

import android.app.Activity
import android.content.Context
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@InvokeArg
class ImprimerArgs {
    lateinit var chemin: String
}

/** Donne au systeme d'impression le PDF tel quel (il est deja mis en page). */
private class AdaptateurPdf(private val fichier: File) : PrintDocumentAdapter() {
    override fun onLayout(
        ancien: PrintAttributes?, nouveau: PrintAttributes, annulation: CancellationSignal?,
        rappel: LayoutResultCallback, extras: Bundle?,
    ) {
        if (annulation?.isCanceled == true) return rappel.onLayoutCancelled()
        val info = PrintDocumentInfo.Builder(fichier.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build()
        rappel.onLayoutFinished(info, ancien != nouveau)
    }

    override fun onWrite(
        pages: Array<out PageRange>, destination: ParcelFileDescriptor, annulation: CancellationSignal?,
        rappel: WriteResultCallback,
    ) {
        try {
            fichier.inputStream().use { entree -> FileOutputStream(destination.fileDescriptor).use { entree.copyTo(it) } }
            rappel.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (ex: Exception) {
            rappel.onWriteFailed(ex.message)
        }
    }
}

/**
 * Fenetre d'impression d'Android sur un PDF du cache de l'app (voir impression.rs) : imprimantes
 * et "Enregistrer au format PDF". L'orientation proposee suit la premiere page du document.
 */
@TauriPlugin
class ImpressionPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun imprimer(invoke: Invoke) {
        try {
            val fichier = File(invoke.parseArgs(ImprimerArgs::class.java).chemin)
            val paysage = PdfRenderer(ParcelFileDescriptor.open(fichier, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
                pdf.openPage(0).use { it.width > it.height }
            }
            val format = PrintAttributes.MediaSize.ISO_A4.let { if (paysage) it.asLandscape() else it.asPortrait() }
            val attributs = PrintAttributes.Builder().setMediaSize(format).build()
            activity.runOnUiThread {
                try {
                    val impression = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                    impression.print(fichier.nameWithoutExtension, AdaptateurPdf(fichier), attributs)
                    invoke.resolve()
                } catch (ex: Exception) {
                    invoke.reject(ex.message)
                }
            }
        } catch (ex: Exception) {
            invoke.reject(ex.message)
        }
    }
}
