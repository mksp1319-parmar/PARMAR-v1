package org.parmar.aether.ui.tabs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.parmar.aether.data.AetherDataLimits
import org.parmar.aether.data.CreateTabResult
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing
import kotlinx.coroutines.launch

@Composable
fun TabsScreen(
    session: LocalTabsSession,
    onCreateTab: suspend () -> CreateTabResult,
    onCloseTab: suspend (String) -> Unit,
    onActivateTab: suspend (String) -> Unit,
    onTogglePin: suspend (String, Boolean) -> Unit,
    onMoveTab: suspend (String, Int) -> Unit,
    onHome: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var pendingClose by remember { mutableStateOf<LocalTab?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize(),
    ) {
        val horizontalPadding = if (maxWidth >= 720.dp) 48.dp else AetherSpacing.large.dp
        val isTabletWidth = maxWidth >= 600.dp
        val contentModifier = if (isTabletWidth) {
            Modifier.fillMaxWidth().padding(horizontal = 24.dp)
        } else {
            Modifier.fillMaxWidth()
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = horizontalPadding)
                .then(contentModifier)
                .padding(vertical = 24.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text(
                        text = "Tabs",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "${session.tabs.size} ${if (session.tabs.size == 1) "tab" else "tabs"}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = AetherColors.textSecondary,
                    )
                }
                OutlinedButton(onClick = onHome) {
                    Text("Home")
                }
            }

            Text(
                text = "Offline shell · remote browsing is disabled.",
                modifier = Modifier.padding(top = 12.dp, bottom = 20.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = AetherColors.textSecondary,
            )

            Button(
                onClick = {
                    scope.launch {
                        message = when (val result = onCreateTab()) {
                            is CreateTabResult.Created -> null
                            CreateTabResult.LimitReached -> "The maximum of 16 tabs has been reached."
                            is CreateTabResult.Failed -> result.message
                        }
                    }
                },
                enabled = session.tabs.size < AetherDataLimits.MAX_TABS,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                Text("New local tab")
            }
            Text(
                text = message ?: "${session.tabs.size} of ${AetherDataLimits.MAX_TABS} local tab descriptors. Saved URLs are metadata only.",
                modifier = Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = AetherColors.textSecondary,
            )

            Spacer(modifier = Modifier.height(20.dp))

            if (session.tabs.isEmpty()) {
                EmptyTabsState(modifier = Modifier.weight(1f))
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(
                        items = session.tabs,
                        key = LocalTab::id,
                    ) { tab ->
                        LocalTabCard(
                            tab = tab,
                            isActive = session.activeTabId == tab.id,
                            canMoveUp = session.tabs.indexOf(tab) > 0 &&
                                session.tabs[session.tabs.indexOf(tab) - 1].pinned == tab.pinned,
                            canMoveDown = session.tabs.indexOf(tab) < session.tabs.lastIndex &&
                                session.tabs[session.tabs.indexOf(tab) + 1].pinned == tab.pinned,
                            onSelect = { scope.launch { onActivateTab(tab.id) } },
                            onPin = { scope.launch { onTogglePin(tab.id, !tab.pinned) } },
                            onMove = { direction -> scope.launch { onMoveTab(tab.id, direction) } },
                            onClose = { pendingClose = tab },
                        )
                    }

                }
            }
        }
    }

    pendingClose?.let { tab ->
        AlertDialog(
            onDismissRequest = { pendingClose = null },
            title = { Text("Close local tab?") },
            text = { Text("This removes the tab descriptor and updates the active tab.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        onCloseTab(tab.id)
                        pendingClose = null
                    }
                }) {
                    Text("Close tab")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingClose = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun EmptyTabsState(modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "No local tabs yet",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Create a local placeholder to see it here. It will not open a website.",
                modifier = Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = AetherColors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun LocalTabCard(
    tab: LocalTab,
    isActive: Boolean,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onSelect: () -> Unit,
    onPin: () -> Unit,
    onMove: (Int) -> Unit,
    onClose: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (tab.title.isNullOrBlank()) {
                        if (tab.kind == LocalTabKind.NEW) "New local tab" else "Saved URL tab"
                    } else {
                        tab.title
                    },
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = if (tab.kind == LocalTabKind.SAVED_URL) {
                        "Saved URL only · page content is not stored.\n${tab.url}"
                    } else {
                        "Local descriptor · no website loaded."
                    },
                    modifier = Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = AetherColors.textSecondary,
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                OutlinedButton(onClick = onSelect) {
                    Text(if (isActive) "Selected" else "Select")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = onPin) {
                        Text(if (tab.pinned) "Unpin" else "Pin")
                    }
                    TextButton(onClick = { onMove(-1) }, enabled = canMoveUp) {
                        Text("Move up")
                    }
                    TextButton(onClick = { onMove(1) }, enabled = canMoveDown) {
                        Text("Move down")
                    }
                }
                TextButton(onClick = onClose) {
                    Text("Close")
                }
            }
        }
    }
}
