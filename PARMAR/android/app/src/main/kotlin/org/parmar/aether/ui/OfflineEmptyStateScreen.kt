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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing

object OfflineEmptyStateCopy {
    const val HISTORY =
        "No browsing history has been recorded in this offline shell."
    const val DOWNLOADS =
        "No browser downloads. This shell does not download pages or files."
}

@Composable
fun OfflineEmptyStateScreen(
    title: String,
    emptyMessage: String,
    onHome: () -> Unit,
) {
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize(),
    ) {
        val horizontalPadding = if (maxWidth >= 720.dp) 48.dp else AetherSpacing.large.dp
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = horizontalPadding)
                .widthIn(max = if (maxWidth >= 720.dp) 720.dp else Dp.Unspecified)
                .align(Alignment.TopCenter)
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = title,
                    modifier = Modifier.semantics { heading() },
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                OutlinedButton(
                    onClick = onHome,
                    modifier = Modifier.semantics {
                        stateDescription = "Returns to AETHER Home"
                    },
                ) {
                    Text("Home")
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) {
                        stateDescription = "Empty"
                    },
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = "Nothing here yet",
                        modifier = Modifier.semantics { heading() },
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        text = emptyMessage,
                        modifier = Modifier.padding(top = 10.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = AetherColors.textSecondary,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Offline shell · remote browsing is disabled.",
                style = MaterialTheme.typography.bodySmall,
                color = AetherColors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}
