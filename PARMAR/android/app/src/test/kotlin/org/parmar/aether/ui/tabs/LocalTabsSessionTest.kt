package org.parmar.aether.ui.tabs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.util.UUID

class LocalTabsSessionTest {
    @Test
    fun closingActiveTabSelectsNeighborAndCompactsOrder() {
        val first = tab(order = 0)
        val active = tab(order = 1)
        val last = tab(order = 2)
        val session = LocalTabsSession(
            tabs = listOf(first, active, last),
            activeTabId = active.id,
        )

        val updated = session.close(active.id)

        assertEquals(listOf(first.id, last.id), updated.tabs.map(LocalTab::id))
        assertEquals(listOf(0, 1), updated.tabs.map(LocalTab::order))
        assertEquals(first.id, updated.activeTabId)
    }

    @Test
    fun closingFirstTabSelectsNextAndClosingLastClearsActiveId() {
        val first = tab(order = 0)
        val second = tab(order = 1)
        val session = LocalTabsSession(listOf(first, second), first.id)

        val oneTab = session.close(first.id)
        val empty = oneTab.close(second.id)

        assertEquals(second.id, oneTab.activeTabId)
        assertEquals(emptyList<LocalTab>(), empty.tabs)
        assertNull(empty.activeTabId)
    }

    @Test
    fun activationChangesOnlyTheActiveDescriptorAndUnknownCloseIsANoOp() {
        val first = tab(order = 0)
        val second = tab(order = 1)
        val session = LocalTabsSession(listOf(first, second), first.id)

        assertEquals(second.id, session.activate(second.id).activeTabId)
        assertSame(session, session.close(UUID.randomUUID().toString()))
    }

    private fun tab(order: Int) = LocalTab(
        id = UUID.randomUUID().toString(),
        kind = LocalTabKind.NEW,
        url = null,
        title = null,
        pinned = false,
        order = order,
        createdAt = 0,
        updatedAt = 0,
    )
}
