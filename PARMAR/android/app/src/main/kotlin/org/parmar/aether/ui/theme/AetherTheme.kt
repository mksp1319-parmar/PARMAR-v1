package org.parmar.aether.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object AetherColors {
    val canvas = Color(0xFF141516)
    val surface = Color(0xFF202123)
    val textPrimary = Color(0xFFF4EEE6)
    val textSecondary = Color(0xFFD1C8BE)
    val accentCopper = Color(0xFFE2A46F)
    val statusRestricted = Color(0xFFFFB4AB)
    val borderSubtle = Color(0xFF49433E)
}

object AetherSpacing {
    const val small = 8
    const val medium = 16
    const val large = 24
}

private val aetherColorScheme = darkColorScheme(
    primary = AetherColors.accentCopper,
    onPrimary = AetherColors.canvas,
    secondary = AetherColors.accentCopper,
    onSecondary = AetherColors.canvas,
    background = AetherColors.canvas,
    onBackground = AetherColors.textPrimary,
    surface = AetherColors.surface,
    onSurface = AetherColors.textPrimary,
    outline = AetherColors.borderSubtle,
    error = AetherColors.statusRestricted,
    onError = AetherColors.canvas,
)

@Composable
fun AetherTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = aetherColorScheme,
        typography = Typography(),
        content = content,
    )
}
