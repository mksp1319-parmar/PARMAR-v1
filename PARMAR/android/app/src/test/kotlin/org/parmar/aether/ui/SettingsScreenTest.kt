package org.parmar.aether.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.parmar.aether.ui.navigation.AetherDestination

class SettingsScreenTest {
    @Test
    fun settingsDisplaysTheInstalledVersionName() {
        assertEquals("Version 0.1.0", SettingsCopy.versionLabel("0.1.0"))
        assertEquals(SettingsCopy.VERSION_UNAVAILABLE, SettingsCopy.versionLabel(null))
        assertEquals(SettingsCopy.VERSION_UNAVAILABLE, SettingsCopy.versionLabel("  "))
    }

    @Test
    fun settingsStatusDescribesTheOfflineShellAndLocalPersistenceHonestly() {
        assertEquals(
            "Offline shell · remote browsing is disabled.",
            SettingsCopy.OFFLINE_STATUS,
        )
        assertTrue(SettingsCopy.WEBSITE_STATUS.contains("does not load websites"))
        assertTrue(SettingsCopy.CURRENT_DATA.contains("app-private local storage"))
        assertTrue(SettingsCopy.CURRENT_DATA.contains("history and downloads are empty"))
    }

    @Test
    fun settingsProvidesPrivacyAndHomeDestinations() {
        assertEquals("settings", AetherDestination.SETTINGS.route)
        assertEquals("privacy", AetherDestination.PRIVACY.route)
        assertEquals("home", AetherDestination.HOME.route)
    }
}
