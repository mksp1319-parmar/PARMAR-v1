package org.parmar.aether.ui.navigation

enum class AetherDestination(
    val route: String,
    val label: String,
) {
    HOME("home", "Home"),
    TABS("tabs", "Tabs"),
    BOOKMARKS("bookmarks", "Bookmarks"),
    HISTORY("history", "History"),
    DOWNLOADS("downloads", "Downloads"),
    SETTINGS("settings", "Settings"),
    PRIVACY("privacy", "Privacy"),
    PARMAR_VOKKI("parmar-vokki", "PARMAR / VOKKI"),
}
