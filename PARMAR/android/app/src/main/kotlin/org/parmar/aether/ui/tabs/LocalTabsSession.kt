package org.parmar.aether.ui.tabs

enum class LocalTabKind(val schemaValue: String) {
    NEW("new"),
    SAVED_URL("saved-url");

    companion object {
        fun fromSchemaValue(value: String): LocalTabKind =
            entries.firstOrNull { it.schemaValue == value }
                ?: throw IllegalArgumentException("Unknown tab kind.")
    }
}

data class LocalTab(
    val id: String,
    val kind: LocalTabKind,
    val url: String?,
    val title: String?,
    val pinned: Boolean,
    val order: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val schemaVersion: Int = 1,
)

data class LocalTabsSession(
    val tabs: List<LocalTab> = emptyList(),
    val activeTabId: String? = null,
) {
    val activeTab: LocalTab?
        get() = tabs.firstOrNull { it.id == activeTabId }

    fun activate(id: String): LocalTabsSession {
        require(tabs.any { it.id == id }) { "The selected tab does not exist." }
        return copy(activeTabId = id)
    }

    fun close(id: String): LocalTabsSession {
        val index = tabs.indexOfFirst { it.id == id }
        if (index < 0) return this
        val remaining = tabs.filterNot { it.id == id }
            .mapIndexed { order, tab -> tab.copy(order = order) }
        val nextActive = when {
            remaining.isEmpty() -> null
            activeTabId != id -> activeTabId
            index > 0 -> remaining[index - 1].id
            else -> remaining.first().id
        }
        return LocalTabsSession(remaining, nextActive)
    }
}
