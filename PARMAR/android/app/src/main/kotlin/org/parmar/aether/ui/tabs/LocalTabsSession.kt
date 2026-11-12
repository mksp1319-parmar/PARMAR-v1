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

    fun setPinned(id: String, pinned: Boolean): LocalTabsSession {
        val target = tabs.firstOrNull { it.id == id } ?: return this
        val ordered = tabs
            .map { if (it.id == id) it.copy(pinned = pinned) else it }
            .sortedWith(compareByDescending<LocalTab> { it.pinned }.thenBy { it.order })
            .mapIndexed { order, tab -> tab.copy(order = order) }
        if (ordered == tabs) return this
        return copy(tabs = ordered)
    }

    fun move(id: String, direction: Int): LocalTabsSession {
        require(direction == -1 || direction == 1) { "Tab movement must be one position." }
        val index = tabs.indexOfFirst { it.id == id }
        if (index < 0) return this
        val adjacent = index + direction
        if (adjacent !in tabs.indices || tabs[adjacent].pinned != tabs[index].pinned) return this
        val reordered = tabs.toMutableList().apply {
            add(adjacent, removeAt(index))
        }.mapIndexed { order, tab -> tab.copy(order = order) }
        return copy(tabs = reordered)
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
