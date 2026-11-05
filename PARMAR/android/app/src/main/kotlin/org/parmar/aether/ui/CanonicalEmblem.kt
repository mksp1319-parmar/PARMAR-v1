package org.parmar.aether.ui

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.security.MessageDigest

internal object CanonicalEmblem {
    const val ASSET_NAME = "parmar-emblem.png"
    const val SHA256 = "d2327d8b5853a4c9dd5e43b8a776c3f91a962276b37cd1c8e136cab7db81c98d"

    fun load(context: Context): ImageBitmap {
        val bytes = context.assets.open(ASSET_NAME).use { it.readBytes() }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        check(digest == SHA256) { "The bundled PARMAR emblem does not match the canonical asset." }
        val bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size)) {
            "The canonical PARMAR emblem could not be decoded."
        }
        require(bitmap.width == 552 && bitmap.height == 548) {
            "The canonical PARMAR emblem dimensions are invalid."
        }
        return bitmap.asImageBitmap()
    }
}
