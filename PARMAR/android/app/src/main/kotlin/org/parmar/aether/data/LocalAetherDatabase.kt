package org.parmar.aether.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import org.parmar.aether.ui.bookmarks.AddBookmarkResult
import org.parmar.aether.ui.bookmarks.Bookmark
import org.parmar.aether.ui.bookmarks.BookmarkRepository
import org.parmar.aether.ui.bookmarks.normalizeBookmarkUrl
import org.parmar.aether.ui.tabs.LocalTab
import org.parmar.aether.ui.tabs.LocalTabKind
import org.parmar.aether.ui.tabs.LocalTabsSession
import java.util.UUID

class AetherStorageException(message: String, cause: Throwable? = null) : Exception(message, cause)

enum class ClearStatus(val label: String) {
    DELETED("Deleted"),
    ALREADY_EMPTY("Already empty"),
    FAILED("Failed"),
}

data class ClearResult(
    val category: String,
    val status: ClearStatus,
    val message: String? = null,
)

sealed interface CreateTabResult {
    data class Created(val session: LocalTabsSession) : CreateTabResult
    data object LimitReached : CreateTabResult
    data class Failed(val message: String) : CreateTabResult
}

class LocalAetherDatabase(
    context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
) : SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION),
    BookmarkRepository {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE bookmarks (
                id TEXT NOT NULL PRIMARY KEY,
                url TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                schema_version INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE tabs (
                id TEXT NOT NULL PRIMARY KEY,
                kind TEXT NOT NULL,
                url TEXT,
                title TEXT,
                pinned INTEGER NOT NULL,
                tab_order INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                schema_version INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE metadata (
                key TEXT NOT NULL PRIMARY KEY,
                value TEXT
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw SQLiteException("Unsupported AETHER database migration $oldVersion to $newVersion.")
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw SQLiteException("AETHER database downgrade $oldVersion to $newVersion is not supported.")
    }

    override fun list(): List<Bookmark> = storage("Bookmarks could not be read.") {
        readBookmarks(readableDatabase)
    }

    override fun add(url: String, title: String?): AddBookmarkResult {
        val canonicalUrl = normalizeBookmarkUrl(url) ?: return AddBookmarkResult.InvalidUrl
        val canonicalTitle = normalizeTitle(title) ?: return AddBookmarkResult.TitleTooLong
        return storage("The bookmark could not be saved.") {
            writeTransaction { db ->
                if (db.rawQuery("SELECT 1 FROM bookmarks WHERE url = ?", arrayOf(canonicalUrl)).use { it.moveToFirst() }) {
                    return@writeTransaction AddBookmarkResult.Duplicate
                }
                if (db.rawQuery("SELECT COUNT(*) FROM bookmarks", null).use { it.moveToFirst() && it.getInt(0) >= AetherDataLimits.MAX_BOOKMARKS }) {
                    return@writeTransaction AddBookmarkResult.LimitReached
                }
                val timestamp = checkedTimestamp()
                val bookmark = Bookmark(
                    id = UUID.randomUUID().toString(),
                    url = canonicalUrl,
                    title = canonicalTitle,
                    createdAt = timestamp,
                    updatedAt = timestamp,
                )
                db.insertOrThrow("bookmarks", null, bookmarkValues(bookmark))
                AddBookmarkResult.Added(bookmark)
            }
        }
    }

    override fun update(id: String, url: String, title: String?): AddBookmarkResult {
        val canonicalUrl = normalizeBookmarkUrl(url) ?: return AddBookmarkResult.InvalidUrl
        val canonicalTitle = normalizeTitle(title) ?: return AddBookmarkResult.TitleTooLong
        return storage("The bookmark could not be updated.") {
            writeTransaction { db ->
                val existing = findBookmark(db, id) ?: return@writeTransaction AddBookmarkResult.NotFound
                if (db.rawQuery(
                        "SELECT 1 FROM bookmarks WHERE url = ? AND id != ?",
                        arrayOf(canonicalUrl, id),
                    ).use { it.moveToFirst() }
                ) {
                    return@writeTransaction AddBookmarkResult.Duplicate
                }
                val updated = existing.copy(
                    url = canonicalUrl,
                    title = canonicalTitle,
                    updatedAt = checkedTimestamp(existing.updatedAt),
                )
                db.update("bookmarks", bookmarkValues(updated), "id = ?", arrayOf(id))
                AddBookmarkResult.Updated(updated)
            }
        }
    }

    override fun remove(id: String): Boolean = storage("The bookmark could not be removed.") {
        writeTransaction { db -> db.delete("bookmarks", "id = ?", arrayOf(id)) > 0 }
    }

    fun clearBookmarks(): ClearResult = storage("Bookmarks could not be cleared.") {
        writeTransaction { db ->
            val hadRecords = db.delete("bookmarks", null, null) > 0
            ClearResult("Bookmarks", if (hadRecords) ClearStatus.DELETED else ClearStatus.ALREADY_EMPTY)
        }
    }

    fun tabSession(): LocalTabsSession = storage("Tabs could not be restored.") {
        readTabSession(readableDatabase)
    }

    fun createNewTab(): CreateTabResult = storage("A local tab could not be created.") {
        writeTransaction { db ->
            val session = readTabSession(db)
            if (session.tabs.size >= AetherDataLimits.MAX_TABS) return@writeTransaction CreateTabResult.LimitReached
            val timestamp = checkedTimestamp()
            val tab = LocalTab(
                id = UUID.randomUUID().toString(),
                kind = LocalTabKind.NEW,
                url = null,
                title = null,
                pinned = false,
                order = session.tabs.size,
                createdAt = timestamp,
                updatedAt = timestamp,
            )
            db.insertOrThrow("tabs", null, tabValues(tab))
            writeActiveTabId(db, tab.id)
            CreateTabResult.Created(readTabSession(db))
        }
    }

    fun createSavedUrlTab(url: String, title: String?): CreateTabResult {
        val canonicalUrl = normalizeBookmarkUrl(url) ?: throw IllegalArgumentException("Invalid saved URL.")
        val canonicalTitle = title?.trim()?.takeIf(String::isNotEmpty)?.also {
            require(it.length <= AetherDataLimits.MAX_TITLE_LENGTH) { "Saved URL title is too long." }
        }
        return storage("A saved-URL tab could not be created.") {
            writeTransaction { db ->
                val session = readTabSession(db)
                if (session.tabs.size >= AetherDataLimits.MAX_TABS) return@writeTransaction CreateTabResult.LimitReached
                val timestamp = checkedTimestamp()
                val tab = LocalTab(
                    id = UUID.randomUUID().toString(),
                    kind = LocalTabKind.SAVED_URL,
                    url = canonicalUrl,
                    title = canonicalTitle,
                    pinned = false,
                    order = session.tabs.size,
                    createdAt = timestamp,
                    updatedAt = timestamp,
                )
                db.insertOrThrow("tabs", null, tabValues(tab))
                writeActiveTabId(db, tab.id)
                CreateTabResult.Created(readTabSession(db))
            }
        }
    }

    fun activateTab(id: String): LocalTabsSession = storage("The tab selection could not be saved.") {
        writeTransaction { db ->
            check(findTab(db, id) != null) { "The selected tab no longer exists." }
            writeActiveTabId(db, id)
            readTabSession(db)
        }
    }

    fun closeTab(id: String): LocalTabsSession = storage("The tab could not be closed.") {
        writeTransaction { db ->
            val session = readTabSession(db)
            val index = session.tabs.indexOfFirst { it.id == id }
            if (index < 0) return@writeTransaction session
            db.delete("tabs", "id = ?", arrayOf(id))
            val remaining = session.tabs.filterNot { it.id == id }
            remaining.forEachIndexed { order, tab ->
                db.update(
                    "tabs",
                    ContentValues().apply {
                        put("tab_order", order)
                        put("updated_at", checkedTimestamp(tab.updatedAt))
                    },
                    "id = ?",
                    arrayOf(tab.id),
                )
            }
            val nextActive = when {
                remaining.isEmpty() -> null
                session.activeTabId != id -> session.activeTabId
                index > 0 -> remaining[index - 1].id
                else -> remaining.first().id
            }
            writeActiveTabId(db, nextActive)
            readTabSession(db)
        }
    }

    fun setTabPinned(id: String, pinned: Boolean): LocalTabsSession =
        storage("The tab pin state could not be saved.") {
            writeTransaction { db ->
                val tab = findTab(db, id) ?: return@writeTransaction readTabSession(db)
                if (tab.pinned != pinned) {
                    db.update(
                        "tabs",
                        ContentValues().apply {
                            put("pinned", if (pinned) 1 else 0)
                            put("updated_at", checkedTimestamp(tab.updatedAt))
                        },
                        "id = ?",
                        arrayOf(id),
                    )
                    normalizeTabOrder(db)
                }
                readTabSession(db)
            }
        }

    fun moveTab(id: String, direction: Int): LocalTabsSession {
        require(direction == -1 || direction == 1) { "Tab movement must be one position." }
        return storage("The tab order could not be saved.") {
            writeTransaction { db ->
                val session = readTabSession(db)
                val index = session.tabs.indexOfFirst { it.id == id }
                if (index < 0) return@writeTransaction session
                val adjacent = index + direction
                if (adjacent !in session.tabs.indices || session.tabs[adjacent].pinned != session.tabs[index].pinned) {
                    return@writeTransaction session
                }
                val reordered = session.tabs.toMutableList().apply {
                    add(adjacent, removeAt(index))
                }
                reordered.forEachIndexed { order, tab ->
                    db.update(
                        "tabs",
                        ContentValues().apply {
                            put("tab_order", order)
                            put("updated_at", checkedTimestamp(tab.updatedAt))
                        },
                        "id = ?",
                        arrayOf(tab.id),
                    )
                }
                readTabSession(db)
            }
        }
    }

    fun clearTabs(): ClearResult = storage("Tabs could not be cleared.") {
        writeTransaction { db ->
            val hadRecords = db.delete("tabs", null, null) > 0
            writeActiveTabId(db, null)
            ClearResult("Tabs", if (hadRecords) ClearStatus.DELETED else ClearStatus.ALREADY_EMPTY)
        }
    }

    private fun readBookmarks(db: SQLiteDatabase): List<Bookmark> =
        db.rawQuery(
            "SELECT id, url, title, created_at, updated_at, schema_version FROM bookmarks ORDER BY created_at, id",
            null,
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    require(size < AetherDataLimits.MAX_BOOKMARKS) { "The stored bookmark limit is invalid." }
                    add(cursor.toBookmark())
                }
            }
        }

    private fun findBookmark(db: SQLiteDatabase, id: String): Bookmark? =
        db.rawQuery(
            "SELECT id, url, title, created_at, updated_at, schema_version FROM bookmarks WHERE id = ?",
            arrayOf(id),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toBookmark() else null }

    private fun readTabSession(db: SQLiteDatabase): LocalTabsSession {
        val tabs = db.rawQuery(
            "SELECT id, kind, url, title, pinned, tab_order, created_at, updated_at, schema_version FROM tabs ORDER BY tab_order",
            null,
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    require(size < AetherDataLimits.MAX_TABS) { "The stored tab limit is invalid." }
                    add(cursor.toLocalTab())
                }
            }
        }
        require(tabs.map(LocalTab::order) == tabs.indices.toList()) {
            "Stored tab count or order is invalid."
        }
        val activeId = db.rawQuery("SELECT key, value FROM metadata", null).use { cursor ->
            if (!cursor.moveToFirst()) {
                null
            } else {
                require(cursor.getString(0) == "active_tab_id" && !cursor.isNull(1)) {
                    "Stored tab metadata contains an unknown or invalid key."
                }
                val value = cursor.getString(1)
                require(!cursor.moveToNext()) { "Stored tab metadata contains unknown fields." }
                value
            }
        }
        require((tabs.isEmpty() && activeId == null) || tabs.any { it.id == activeId }) {
            "Stored active tab does not match the session."
        }
        return LocalTabsSession(tabs, activeId)
    }

    private fun findTab(db: SQLiteDatabase, id: String): LocalTab? =
        db.rawQuery(
            "SELECT id, kind, url, title, pinned, tab_order, created_at, updated_at, schema_version FROM tabs WHERE id = ?",
            arrayOf(id),
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toLocalTab() else null }

    private fun normalizeTabOrder(db: SQLiteDatabase) {
        val tabs = readTabSession(db).tabs
        tabs.forEachIndexed { order, tab ->
            db.update(
                "tabs",
                ContentValues().apply {
                    put("tab_order", order)
                    put("updated_at", checkedTimestamp(tab.updatedAt))
                },
                "id = ?",
                arrayOf(tab.id),
            )
        }
    }

    private fun writeActiveTabId(db: SQLiteDatabase, id: String?) {
        if (id == null) {
            db.delete("metadata", "key = 'active_tab_id'", null)
        } else {
            db.insertWithOnConflict(
                "metadata",
                null,
                ContentValues().apply {
                    put("key", "active_tab_id")
                    put("value", id)
                },
                SQLiteDatabase.CONFLICT_REPLACE,
            )
        }
    }

    private inline fun <T> writeTransaction(block: (SQLiteDatabase) -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val result = block(db)
            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    private inline fun <T> storage(message: String, block: () -> T): T =
        try {
            block()
        } catch (error: SQLiteException) {
            throw AetherStorageException(message, error)
        } catch (error: IllegalArgumentException) {
            throw AetherStorageException(message, error)
        } catch (error: IllegalStateException) {
            throw AetherStorageException(message, error)
        }

    private fun checkedTimestamp(notBefore: Long = 0): Long = clock().coerceAtLeast(notBefore).also {
        require(it >= 0L) { "The device clock returned an invalid timestamp." }
    }

    private fun Cursor.toBookmark(): Bookmark {
        val bookmark = Bookmark(
            id = getString(0),
            url = getString(1),
            title = getString(2),
            createdAt = getLong(3),
            updatedAt = getLong(4),
            schemaVersion = getInt(5),
        )
        require(validUuid(bookmark.id) && bookmark.schemaVersion == RECORD_SCHEMA_VERSION)
        require(normalizeBookmarkUrl(bookmark.url) == bookmark.url)
        require(bookmark.title.isNotBlank() && bookmark.title == bookmark.title.trim())
        require(bookmark.title.length <= AetherDataLimits.MAX_TITLE_LENGTH)
        require(bookmark.createdAt >= 0 && bookmark.updatedAt >= bookmark.createdAt)
        return bookmark
    }

    private fun Cursor.toLocalTab(): LocalTab {
        val pinnedValue = getInt(4)
        require(pinnedValue == 0 || pinnedValue == 1) { "Stored tab pin value is invalid." }
        val tab = LocalTab(
            id = getString(0),
            kind = LocalTabKind.fromSchemaValue(getString(1)),
            url = if (isNull(2)) null else getString(2),
            title = if (isNull(3)) null else getString(3),
            pinned = pinnedValue == 1,
            order = getInt(5),
            createdAt = getLong(6),
            updatedAt = getLong(7),
            schemaVersion = getInt(8),
        )
        require(validUuid(tab.id) && tab.schemaVersion == RECORD_SCHEMA_VERSION)
        require(tab.order >= 0 && tab.createdAt >= 0 && tab.updatedAt >= tab.createdAt)
        require(tab.title == null || (tab.title == tab.title.trim() && tab.title.isNotEmpty() && tab.title.length <= AetherDataLimits.MAX_TITLE_LENGTH))
        when (tab.kind) {
            LocalTabKind.NEW -> require(tab.url == null)
            LocalTabKind.SAVED_URL -> require(tab.url != null && normalizeBookmarkUrl(tab.url) == tab.url)
        }
        return tab
    }

    private fun bookmarkValues(bookmark: Bookmark) = ContentValues().apply {
        put("id", bookmark.id)
        put("url", bookmark.url)
        put("title", bookmark.title)
        put("created_at", bookmark.createdAt)
        put("updated_at", bookmark.updatedAt)
        put("schema_version", bookmark.schemaVersion)
    }

    private fun tabValues(tab: LocalTab) = ContentValues().apply {
        put("id", tab.id)
        put("kind", tab.kind.schemaValue)
        put("url", tab.url)
        put("title", tab.title)
        put("pinned", if (tab.pinned) 1 else 0)
        put("tab_order", tab.order)
        put("created_at", tab.createdAt)
        put("updated_at", tab.updatedAt)
        put("schema_version", tab.schemaVersion)
    }

    private fun validUuid(value: String): Boolean =
        try {
            UUID.fromString(value).toString() == value.lowercase()
        } catch (_: IllegalArgumentException) {
            false
        }

    private fun normalizeTitle(title: String?): String? {
        val trimmed = title?.trim()?.takeIf(String::isNotEmpty) ?: "Saved address"
        return trimmed.takeIf { it.length <= AetherDataLimits.MAX_TITLE_LENGTH }
    }

    companion object {
        private const val DATABASE_NAME = "aether-local.db"
        private const val DATABASE_VERSION = 1
        private const val RECORD_SCHEMA_VERSION = AetherDataLimits.RECORD_SCHEMA_VERSION
    }
}
