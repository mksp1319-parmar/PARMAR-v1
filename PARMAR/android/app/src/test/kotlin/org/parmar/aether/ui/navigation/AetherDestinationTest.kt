package org.parmar.aether.ui.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AetherDestinationTest {
    @Test
    fun foundationRoutesAreUniqueAndCoverApprovedDestinations() {
        val destinations = AetherDestination.entries
        val routes = destinations.map(AetherDestination::route)

        assertEquals(8, destinations.size)
        assertEquals(routes.size, routes.toSet().size)
        assertTrue(destinations.any { it == AetherDestination.HOME })
        assertTrue(destinations.any { it == AetherDestination.TABS })
        assertTrue(destinations.any { it == AetherDestination.BOOKMARKS })
        assertTrue(destinations.any { it == AetherDestination.HISTORY })
        assertTrue(destinations.any { it == AetherDestination.DOWNLOADS })
        assertTrue(destinations.any { it == AetherDestination.SETTINGS })
        assertTrue(destinations.any { it == AetherDestination.PRIVACY })
        assertTrue(destinations.any { it == AetherDestination.PARMAR_VOKKI })
    }
}
