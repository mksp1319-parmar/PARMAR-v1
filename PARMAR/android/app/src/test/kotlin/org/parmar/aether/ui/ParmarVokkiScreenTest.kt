package org.parmar.aether.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.parmar.aether.ui.navigation.AetherDestination

class ParmarVokkiScreenTest {
    @Test
    fun parmarIdentityPurposeAndHumanOversightAreDisplayed() {
        assertEquals(
            "Predictive AI–Risk Mediation & Autonomous Reasoning",
            ParmarVokkiCopy.PARMAR_NAME,
        )
        assertTrue(ParmarVokkiCopy.PARMAR_PURPOSE.contains("AI governance"))
        assertTrue(ParmarVokkiCopy.PARMAR_PURPOSE.contains("decision-support"))
        assertTrue(ParmarVokkiCopy.HUMAN_OVERSIGHT.contains("Human decision-making"))
        assertTrue(ParmarVokkiCopy.HUMAN_OVERSIGHT.contains("explicit human approval"))
    }

    @Test
    fun vokkiRoleAndNativeAndroidLimitationsAreClear() {
        assertTrue(ParmarVokkiCopy.VOKKI_ROLE.contains("human-facing assistant component"))
        assertTrue(ParmarVokkiCopy.VOKKI_ROLE.contains("voice and visual interaction"))
        assertTrue(ParmarVokkiCopy.VOKKI_LIMITS.contains("voice input"))
        assertTrue(ParmarVokkiCopy.VOKKI_LIMITS.contains("wake-word detection"))
        assertTrue(ParmarVokkiCopy.VOKKI_LIMITS.contains("not implemented"))
        assertTrue(ParmarVokkiCopy.VOKKI_LIMITS.contains("suggestions do not approve browser actions"))
        assertTrue(ParmarVokkiCopy.VOKKI_LIMITS.contains("limited to the action shown"))
    }

    @Test
    fun aetherIsDescribedAsAnOfflineAndroidShell() {
        assertTrue(ParmarVokkiCopy.AETHER_ROLE.contains("browser project"))
        assertTrue(ParmarVokkiCopy.AETHER_ROLE.contains("offline native shell"))
        assertTrue(ParmarVokkiCopy.AETHER_ROLE.contains("does not load websites"))
        assertTrue(ParmarVokkiCopy.AETHER_ROLE.contains("does not provide remote browsing"))
    }

    @Test
    fun productInformationRouteAndHomeReturnAreAvailable() {
        assertEquals("parmar-vokki", AetherDestination.PARMAR_VOKKI.route)
        assertEquals("home", AetherDestination.HOME.route)
        assertEquals(6, ParmarVokkiCopy.sections.size)
        assertTrue(ParmarVokkiCopy.sections.any { it.title == "PARMAR" })
        assertTrue(ParmarVokkiCopy.sections.any { it.title == "VOKKI" })
        assertTrue(ParmarVokkiCopy.sections.any { it.title == "AETHER" })
    }
}
