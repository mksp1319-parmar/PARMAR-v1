package org.parmar.aether.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.parmar.aether.ui.navigation.AetherDestination
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing

private val destinations = listOf(
    AetherDestination.TABS to ("Your tabs" to "Manage local tab descriptors; saved addresses remain inert."),
    AetherDestination.BOOKMARKS to ("Bookmarks" to "Save, search and manage HTTPS addresses locally."),
    AetherDestination.HISTORY to ("History" to "No browsing history has been recorded in this offline shell."),
    AetherDestination.DOWNLOADS to ("Downloads" to "No browser downloads. This shell does not download pages or files."),
    AetherDestination.SETTINGS to ("Settings" to "View app information and current offline status."),
    AetherDestination.PARMAR_VOKKI to ("PARMAR / VOKKI" to "Learn about PARMAR's human oversight, VOKKI and AETHER."),
)

@Composable
fun HomeScreen(onNavigate: (AetherDestination) -> Unit) {
    val context = LocalContext.current
    val emblem = remember(context) { CanonicalEmblem.load(context) }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        val horizontalPadding = if (maxWidth >= 720.dp) 48.dp else AetherSpacing.large.dp
        val isWideLayout = maxWidth >= 640.dp

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = horizontalPadding, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (isWideLayout) Modifier.padding(horizontal = 24.dp)
                        else Modifier,
                    ),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    androidx.compose.foundation.Image(
                        bitmap = emblem,
                        contentDescription = "Original PARMAR emblem",
                        modifier = Modifier.size(72.dp),
                        contentScale = ContentScale.Fit,
                    )
                    Column {
                        Text(
                            text = "AETHER",
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "A quieter space for what matters.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = AetherColors.textSecondary,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                OfflineStatusCard()

                OutlinedTextField(
                    value = "",
                    onValueChange = {},
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                    enabled = false,
                    label = { Text("Address and search") },
                    supportingText = {
                        Text("Address and search are unavailable while browsing is disabled.")
                    },
                    singleLine = true,
                )

                Spacer(modifier = Modifier.height(28.dp))

                Text(
                    text = "Your space",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = "Manage local browser metadata. No websites are loaded or browsing activity recorded.",
                    modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = AetherColors.textSecondary,
                )

                if (isWideLayout) {
                    destinations.chunked(2).forEach { rowDestinations ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            rowDestinations.forEach { (destination, content) ->
                                DestinationCard(
                                    destination = destination,
                                    title = content.first,
                                    description = content.second,
                                    onClick = { onNavigate(destination) },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            if (rowDestinations.size == 1) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                } else {
                    destinations.forEach { (destination, content) ->
                        DestinationCard(
                            destination = destination,
                            title = content.first,
                            description = content.second,
                            onClick = { onNavigate(destination) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                    }
                }

                Text(
                    text = "PARMAR · AETHER",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp, bottom = 8.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = AetherColors.textSecondary,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun OfflineStatusCard() {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = AetherColors.borderSubtle,
                shape = RoundedCornerShape(20.dp),
            ),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(9.dp)
                        .background(AetherColors.accentCopper, CircleShape),
                )
                Text(
                    text = "OFFLINE SHELL",
                    style = MaterialTheme.typography.labelLarge,
                    color = AetherColors.accentCopper,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Text(
                text = "Remote browsing is disabled.",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Address and search are unavailable while browsing is disabled.",
                style = MaterialTheme.typography.bodyMedium,
                color = AetherColors.textSecondary,
            )
        }
    }
}

@Composable
private fun DestinationCard(
    destination: AetherDestination,
    title: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier
            .heightIn(min = 132.dp)
            .semantics { stateDescription = "Opens ${destination.label}" },
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(18.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = AetherColors.textSecondary,
            )
        }
    }
}
