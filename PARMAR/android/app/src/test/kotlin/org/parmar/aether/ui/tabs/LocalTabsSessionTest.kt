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

    @Test
    fun pinningKeepsPinnedTabsTogetherFirstAndPreservesRelativeOrder() {
        val first = tab(order = 0, pinned = true)
        val second = tab(order = 1)
        val third = tab(order = 2)
        val session = LocalTabsSession(listOf(first, second, third), second.id)

        val pinned = session.setPinned(third.id, true)
        val unpinned = pinned.setPinned(first.id, false)

        assertEquals(listOf(first.id, third.id, second.id), pinned.tabs.map(LocalTab::id))
        assertEquals(listOf(true, true, false), pinned.tabs.map(LocalTab::pinned))
        assertEquals(listOf(0, 1, 2), pinned.tabs.map(LocalTab::order))
        assertEquals(second.id, pinned.activeTabId)
        assertEquals(listOf(third.id, first.id, second.id), unpinned.tabs.map(LocalTab::id))
        assertEquals(listOf(true, false, false), unpinned.tabs.map(LocalTab::pinned))
    }

    @Test
    fun movingTabsReordersOnlyWithinPinnedGroupAndCompactsPositions() {
        val pinnedFirst = tab(order = 0, pinned = true)
        val pinnedSecond = tab(order = 1, pinned = true)
        val regularFirst = tab(order = 2)
        val regularSecond = tab(order = 3)
        val session = LocalTabsSession(
            listOf(pinnedFirst, pinnedSecond, regularFirst, regularSecond),
            regularFirst.id,
        )

        val movedPinned = session.move(pinnedSecond.id, -1)
        val movedRegular = movedPinned.move(regularFirst.id, 1)

        assertEquals(
            listOf(pinnedSecond.id, pinnedFirst.id, regularFirst.id, regularSecond.id),
            movedPinned.tabs.map(LocalTab::id),
        )
        assertSame(movedPinned, movedPinned.move(regularFirst.id, -1))
        assertEquals(
            listOf(pinnedSecond.id, pinnedFirst.id, regularSecond.id, regularFirst.id),
            movedRegular.tabs.map(LocalTab::id),
        )
        assertEquals(listOf(0, 1, 2, 3), movedRegular.tabs.map(LocalTab::order))
        assertEquals(regularFirst.id, movedRegular.activeTabId)
    }

    @Test
    fun unknownTabPinAndInvalidMoveDirectionAreHandledSafely() {
        val session = LocalTabsSession(listOf(tab(order = 0)))

        assertSame(session, session.setPinned(UUID.randomUUID().toString(), true))
        assertSame(session, session.move(UUID.randomUUID().toString(), 1))
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            session.move(session.tabs.single().id, 0)
        }
    }

    private fun tab(order: Int, pinned: Boolean = false) = LocalTab(
        id = UUID.randomUUID().toString(),
        kind = LocalTabKind.NEW,
        url = null,
        title = null,
        pinned = pinned,
        order = order,
        createdAt = 0,
        updatedAt = 0,
    )
}
