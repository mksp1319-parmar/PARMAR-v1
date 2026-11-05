package org.parmar.aether.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing

data class ProductInformationSection(
    val title: String,
    val description: String,
)

object ParmarVokkiCopy {
    const val PARMAR_NAME =
        "Predictive AI–Risk Mediation & Autonomous Reasoning"
    const val PARMAR_PURPOSE =
        "PARMAR is a human-centered AI governance, safety and decision-support system. It reviews proposals and applies safety checks."
    const val HUMAN_OVERSIGHT =
        "Human decision-making remains central. Consequential actions require explicit human approval."
    const val VOKKI_ROLE =
        "VOKKI is PARMAR's human-facing assistant component. Its intended role includes voice and visual interaction."
    const val VOKKI_LIMITS =
        "VOKKI suggestions do not approve browser actions. Any future approval is explicit and limited to the action shown. Native Android voice input, wake-word detection and live assistant integration are not implemented in this milestone."
    const val AETHER_ROLE =
        "AETHER is PARMAR's browser project. This Android build is currently an offline native shell; it does not load websites or provide remote browsing."

    val sections = listOf(
        ProductInformationSection("PARMAR", PARMAR_NAME),
        ProductInformationSection("Purpose and human oversight", PARMAR_PURPOSE),
        ProductInformationSection("Human decision-making", HUMAN_OVERSIGHT),
        ProductInformationSection("VOKKI", VOKKI_ROLE),
        ProductInformationSection("Android integration status", VOKKI_LIMITS),
        ProductInformationSection("AETHER", AETHER_ROLE),
    )
}

@Composable
fun ParmarVokkiScreen(onHome: () -> Unit) {
    val context = LocalContext.current
    val emblem = remember(context) { CanonicalEmblem.load(context) }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = if (maxWidth >= 720.dp) 48.dp else AetherSpacing.large.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .widthIn(max = if (maxWidth >= 720.dp) 760.dp else Dp.Unspecified)
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
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Image(
                        bitmap = emblem,
                        contentDescription = "Original PARMAR emblem",
                        modifier = Modifier.size(56.dp),
                        contentScale = ContentScale.Fit,
                    )
                    Text(
                        text = "PARMAR / VOKKI",
                        modifier = Modifier.semantics { heading() },
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onBackground,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                OutlinedButton(onClick = onHome) {
                    Text("Home")
                }
            }

            ProductInformationCard(ParmarVokkiCopy.sections.first())
            ProductInformationCard(ParmarVokkiCopy.sections[1])
            ProductInformationCard(ParmarVokkiCopy.sections[2])
            ProductInformationCard(ParmarVokkiCopy.sections[3])
            ProductInformationCard(ParmarVokkiCopy.sections[4])
            ProductInformationCard(ParmarVokkiCopy.sections[5])
            Spacer(modifier = Modifier.height(4.dp))
        }
    }
}

@Composable
private fun ProductInformationCard(section: ProductInformationSection) {
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
