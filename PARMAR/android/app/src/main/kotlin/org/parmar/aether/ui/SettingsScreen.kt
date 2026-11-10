package org.parmar.aether.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.parmar.aether.R
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing

object SettingsCopy {
    const val VERSION_UNAVAILABLE = "Version unavailable"
    const val OFFLINE_STATUS = "Offline shell · remote browsing is disabled."
    const val WEBSITE_STATUS = "This Android app does not load websites."
    const val CURRENT_DATA =
        "Bookmarks and tab descriptors are stored in app-private local storage. Browsing history and downloads are empty; this shell does not record visits or download files."

    fun versionLabel(versionName: String?): String =
        versionName?.takeIf(String::isNotBlank)?.let { "Version $it" } ?: VERSION_UNAVAILABLE
}

@Composable
fun SettingsScreen(
    appVersion: String?,
    onPrivacy: () -> Unit,
    onHome: () -> Unit,
) {
    val appName = stringResource(R.string.app_name)

    BoxWithConstraints(
        modifier = Modifier.fillMaxSize(),
    ) {
        val horizontalPadding = if (maxWidth >= 720.dp) 48.dp else AetherSpacing.large.dp
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = horizontalPadding)
                .widthIn(max = if (maxWidth >= 720.dp) 720.dp else androidx.compose.ui.unit.Dp.Unspecified)
                .align(Alignment.TopCenter)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 24.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "Settings",
                    modifier = Modifier.semantics { heading() },
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontWeight = FontWeight.SemiBold,
                )
                OutlinedButton(onClick = onHome) {
                    Text("Home")
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            InformationCard(title = "App information") {
                Text(
                    text = appName,
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = SettingsCopy.versionLabel(appVersion),
                    modifier = Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = AetherColors.textSecondary,
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            InformationCard(title = "Offline status") {
                Text(
                    text = SettingsCopy.OFFLINE_STATUS,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = SettingsCopy.WEBSITE_STATUS,
                    modifier = Modifier.padding(top = 6.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = AetherColors.textSecondary,
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            InformationCard(title = "Current app information") {
                Text(
                    text = SettingsCopy.CURRENT_DATA,
                    style = MaterialTheme.typography.bodyMedium,
                    color = AetherColors.textSecondary,
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Button(
                onClick = onPrivacy,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                Text("Privacy")
            }
            Text(
                text = "Review current app behavior, data and permissions.",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = AetherColors.textSecondary,
            )
        }
    }
}

@Composable
private fun InformationCard(
    title: String,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
        ) {
            Text(
                text = title,
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.height(10.dp))
            content()
        }
    }
}

@Suppress("DEPRECATION")
internal fun installedAppVersionName(context: Context): String? =
    context.packageManager.getPackageInfo(context.packageName, 0).versionName
