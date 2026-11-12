package org.parmar.aether.data

import android.test.AndroidTestCase
import org.parmar.aether.ui.tabs.LocalTab

class LocalAetherDatabaseTest : AndroidTestCase() {
    private lateinit var database: LocalAetherDatabase

    override fun setUp() {
        super.setUp()
        context.deleteDatabase(DATABASE_NAME)
        database = newDatabase()
    }

    override fun tearDown() {
        database.close()
        context.deleteDatabase(DATABASE_NAME)
        super.tearDown()
    }

    fun testPinningAndUnpinningPersistOrderAcrossDatabaseReopen() {
        val first = createTab()
        val second = createTab()
        val third = createTab()

        database.setTabPinned(third, true)
        reopenDatabase()
        assertPersistedSession(
            ids = listOf(third, first, second),
            pinned = listOf(true, false, false),
        )

        database.setTabPinned(third, false)
        reopenDatabase()
        assertPersistedSession(
            ids = listOf(first, second, third),
            pinned = listOf(false, false, false),
        )
    }

    fun testMovementPersistsWithinPinnedAndUnpinnedGroups() {
        val pinnedFirst = createTab()
        val pinnedSecond = createTab()
        val regularFirst = createTab()
        val regularSecond = createTab()
        database.setTabPinned(pinnedFirst, true)
        database.setTabPinned(pinnedSecond, true)

        database.moveTab(pinnedSecond, -1)
        reopenDatabase()
        assertPersistedSession(
            ids = listOf(pinnedSecond, pinnedFirst, regularFirst, regularSecond),
            pinned = listOf(true, true, false, false),
        )

        database.moveTab(regularFirst, 1)
        reopenDatabase()
        assertPersistedSession(
            ids = listOf(pinnedSecond, pinnedFirst, regularSecond, regularFirst),
            pinned = listOf(true, true, false, false),
        )
    }

    private fun createTab(): String {
        return when (val result = database.createNewTab()) {
            is CreateTabResult.Created -> result.session.activeTabId
                ?: throw AssertionError("Creating a tab did not select it.")
            CreateTabResult.LimitReached -> throw AssertionError("The tab limit was unexpectedly reached.")
            is CreateTabResult.Failed -> throw AssertionError("Creating a tab failed: ${result.message}")
        }
    }

    private fun reopenDatabase() {
        database.close()
        database = newDatabase()
    }

    private fun newDatabase() = LocalAetherDatabase(context) { 1_000L }

    private fun assertPersistedSession(ids: List<String>, pinned: List<Boolean>) {
        val tabs = database.tabSession().tabs
        assertEquals(ids, tabs.map(LocalTab::id))
        assertEquals(pinned, tabs.map(LocalTab::pinned))
        assertEquals(tabs.indices.toList(), tabs.map(LocalTab::order))
    }

    companion object {
        private const val DATABASE_NAME = "aether-local.db"
    }
}
