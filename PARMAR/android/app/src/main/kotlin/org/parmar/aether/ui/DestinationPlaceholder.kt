package org.parmar.aether.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.parmar.aether.ui.navigation.AetherDestination
import org.parmar.aether.ui.theme.AetherColors

@Composable
fun DestinationPlaceholder(
    destination: AetherDestination,
    onBack: () -> Unit,
    onHome: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = destination.label,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = destination.message(),
                modifier = Modifier.padding(vertical = 16.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = AetherColors.textSecondary,
                textAlign = TextAlign.Center,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(onClick = onBack) {
                    Text("Back")
                }
                Button(onClick = onHome) {
                    Text("Home")
                }
            }
        }
    }
}

private fun AetherDestination.message(): String = when (this) {
    AetherDestination.HOME -> "AETHER Home."
    AetherDestination.TABS -> "Local tabs are available from the Tabs screen."
    AetherDestination.BOOKMARKS -> "Bookmarks are available from the Bookmarks screen."
    AetherDestination.HISTORY -> "No browsing history has been recorded in this offline shell."
    AetherDestination.DOWNLOADS -> "No browser downloads. This shell does not download pages or files."
    AetherDestination.SETTINGS -> "Settings are available from the Settings screen."
    AetherDestination.PRIVACY ->
        "Privacy information is available from the Privacy screen."
    AetherDestination.PARMAR_VOKKI ->
        "PARMAR and VOKKI information is available from its dedicated screen."
}
