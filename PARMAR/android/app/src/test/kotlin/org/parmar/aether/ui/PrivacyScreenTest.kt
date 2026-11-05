package org.parmar.aether.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.parmar.aether.ui.navigation.AetherDestination

class PrivacyScreenTest {
    @Test
    fun privacySectionsDescribeCurrentOfflineAndPermissionBehaviorWithLimits() {
        assertTrue(PrivacyCopy.OFFLINE.contains("does not load websites"))
        assertTrue(PrivacyCopy.OFFLINE.contains("does not make browsing requests"))
        assertTrue(PrivacyCopy.PERMISSIONS.contains("source manifest currently declares no permissions"))
        assertTrue(PrivacyCopy.PERMISSIONS.contains("does not verify every runtime or device behavior"))
    }

    @Test
    fun privacySectionsAccuratelyDescribeLocalMetadataAndEmptyFeatures() {
        assertTrue(PrivacyCopy.LOCAL_DATA.contains("app-private local storage"))
        assertTrue(PrivacyCopy.TABS.contains("metadata only"))
        assertTrue(PrivacyCopy.TABS.contains("never loaded"))
        assertTrue(PrivacyCopy.BOOKMARKS.contains("store addresses, not page content"))
        assertTrue(PrivacyCopy.HISTORY.contains("has no browsing records"))
        assertTrue(PrivacyCopy.DOWNLOADS.contains("no downloaded files or active transfers"))
    }

    @Test
    fun privacyExplainsDeletionBoundariesWithoutClaimingSecureErasure() {
        assertTrue(PrivacyCopy.DELETION.contains("app records only"))
        assertTrue(PrivacyCopy.DELETION.contains("do not prove secure erasure"))
    }

    @Test
    fun privacyAndReturnDestinationsAreAvailableInNativeNavigation() {
        assertEquals("privacy", AetherDestination.PRIVACY.route)
        assertEquals("settings", AetherDestination.SETTINGS.route)
        assertEquals("home", AetherDestination.HOME.route)
        assertEquals(
            listOf(
                "Offline shell",
                "Permissions",
                "Local data",
                "Tabs",
                "Bookmarks",
                "History",
                "Downloads",
                "Deletion",
            ),
            PrivacyCopy.sections.map(PrivacySection::title),
        )
    }
}
