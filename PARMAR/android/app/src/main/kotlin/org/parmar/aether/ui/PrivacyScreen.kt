package org.parmar.aether.ui

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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.parmar.aether.data.ClearResult
import org.parmar.aether.data.ClearStatus
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing
import kotlinx.coroutines.launch

data class PrivacySection(
    val title: String,
    val description: String,
)

object PrivacyCopy {
    const val OFFLINE =
        "This offline-shell milestone does not load websites and does not make browsing requests."
    const val PERMISSIONS =
        "The Android source manifest currently declares no permissions. This describes the manifest only; it does not verify every runtime or device behavior."
    const val LOCAL_DATA =
        "Bookmarks and tab descriptors are stored in app-private local storage. URLs and titles are sensitive metadata, not website content."
    const val TABS =
        "Tab descriptors store local metadata only. A saved URL is never loaded or sent to another app."
    const val BOOKMARKS =
        "Bookmarks store addresses, not page content. Titles are user-entered labels; missing titles use a generic label."
    const val HISTORY =
        "The History screen has no browsing records. This shell does not browse or record visits."
    const val DOWNLOADS =
        "There are no downloaded files or active transfers. This shell does not download pages or files."
    const val DELETION =
        "Clear actions remove addressed app records only. They do not prove secure erasure from flash storage, backups, operating-system snapshots, or other artifacts."

    val sections = listOf(
        PrivacySection("Offline shell", OFFLINE),
        PrivacySection("Permissions", PERMISSIONS),
        PrivacySection("Local data", LOCAL_DATA),
        PrivacySection("Tabs", TABS),
        PrivacySection("Bookmarks", BOOKMARKS),
        PrivacySection("History", HISTORY),
        PrivacySection("Downloads", DOWNLOADS),
        PrivacySection("Deletion", DELETION),
    )
}

@Composable
fun PrivacyScreen(
    onSettings: () -> Unit,
    onHome: () -> Unit,
    onClearCategory: suspend (String) -> ClearResult,
    onClearAll: suspend () -> List<ClearResult>,
) {
    val scope = rememberCoroutineScope()
    var pendingCategory by remember { mutableStateOf<String?>(null) }
    var results by remember { mutableStateOf<List<ClearResult>>(emptyList()) }
    var showClearAllConfirmation by remember { mutableStateOf(false) }
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize(),
    ) {
        val availableWidth = maxWidth
        val horizontalPadding = if (availableWidth >= 720.dp) 48.dp else AetherSpacing.large.dp
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = horizontalPadding)
                .widthIn(max = if (maxWidth >= 720.dp) 720.dp else Dp.Unspecified)
                .align(Alignment.TopCenter)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "Privacy",
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontWeight = FontWeight.SemiBold,
                )
                if (availableWidth >= 400.dp) {
                    PrivacyNavigationButtons(onSettings, onHome)
                }
            }
            if (availableWidth < 400.dp) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    PrivacyNavigationButtons(onSettings, onHome)
                }
            }

            PrivacyCopy.sections.forEach { section ->
                PrivacyInformationCard(section)
            }

            PrivacyInformationCard(
                PrivacySection(
                    "Local data controls",
                    "History and Downloads are empty and are not deletion targets.",
                ),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { pendingCategory = "Tabs" },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Clear tabs")
                }
                OutlinedButton(
                    onClick = { pendingCategory = "Bookmarks" },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Clear bookmarks")
                }
            }
            Button(
                onClick = { showClearAllConfirmation = true },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Clear all local data")
            }
            if (results.any { it.status == ClearStatus.FAILED }) {
                Text(
                    text = "Some data could not be deleted. Review the category results below.",
                    color = MaterialTheme.colorScheme.error,
                )
            } else if (results.isNotEmpty()) {
                Text(
                    text = "Every requested category was deleted or already empty.",
                    color = AetherColors.textSecondary,
                )
            }
            results.forEach { result ->
                ClearResultCard(
                    result = result,
                    onRetry = {
                        scope.launch {
                            results = results.map {
                                if (it.category == result.category) onClearCategory(it.category) else it
                            }
                        }
                    },
                )
            }
        }
    }

    pendingCategory?.let { category ->
        AlertDialog(
            onDismissRequest = { pendingCategory = null },
            title = { Text("Clear $category?") },
            text = { Text("This permanently removes the selected local $category metadata from AETHER.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        results = listOf(onClearCategory(category))
                        pendingCategory = null
                    }
                }) {
                    Text("Clear $category")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingCategory = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (showClearAllConfirmation) {
        AlertDialog(
            onDismissRequest = { showClearAllConfirmation = false },
            title = { Text("Clear all local data?") },
            text = { Text("This removes tab descriptors and bookmarks. History and Downloads are not included because they are empty.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        results = onClearAll()
                        showClearAllConfirmation = false
                    }
                }) {
                    Text("Clear local data")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearAllConfirmation = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun ClearResultCard(result: ClearResult, onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "${result.category}: ${result.status.label}",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                result.message?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = AetherColors.textSecondary,
                    )
                }
            }
            if (result.status == ClearStatus.FAILED) {
                TextButton(onClick = onRetry) {
                    Text("Retry")
                }
            }
        }
    }
}

@Composable
private fun PrivacyNavigationButtons(
    onSettings: () -> Unit,
    onHome: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onSettings) {
            Text("Settings")
        }
        OutlinedButton(onClick = onHome) {
            Text("Home")
        }
    }
}

@Composable
private fun PrivacyInformationCard(section: PrivacySection) {
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
                text = section.title,
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = section.description,
                style = MaterialTheme.typography.bodyMedium,
                color = AetherColors.textSecondary,
            )
        }
    }
}
