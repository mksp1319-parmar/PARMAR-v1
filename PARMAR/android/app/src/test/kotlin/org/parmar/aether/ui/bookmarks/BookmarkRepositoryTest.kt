package org.parmar.aether.ui.bookmarks

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class BookmarkRepositoryTest {
    @Test
    fun createsValidCredentialFreeHttpsBookmarkAndNormalizesOptionalTitle() {
        val repository = InMemoryBookmarkRepository()

        val result = repository.add("  HTTPS://Example.TEST:443  ", "  Reference  ")

        assertTrue(result is AddBookmarkResult.Added)
        val bookmark = (result as AddBookmarkResult.Added).bookmark
        assertEquals("https://example.test/", bookmark.url)
        assertEquals("Reference", bookmark.title)
        assertEquals(listOf(bookmark), repository.list())
    }

    @Test
    fun blankOptionalTitleUsesGenericSavedAddressLabel() {
        val result = InMemoryBookmarkRepository().add("https://example.test", "  ")

        assertTrue(result is AddBookmarkResult.Added)
        val bookmark = (result as AddBookmarkResult.Added).bookmark
        assertEquals("Saved address", bookmark.title)
        assertEquals(bookmark.id, UUID.fromString(bookmark.id).toString())
        assertTrue(bookmark.createdAt >= 0)
        assertEquals(bookmark.createdAt, bookmark.updatedAt)
        assertEquals(1, bookmark.schemaVersion)
    }

    @Test
    fun rejectsNonHttpsMalformedCredentialedAndOverlongUrls() {
        val repository = InMemoryBookmarkRepository()

        assertEquals(AddBookmarkResult.InvalidUrl, repository.add("http://example.test", null))
        val credentialedUrl =
            "https://${listOf("account", "token").joinToString(":")}@example.test/"
        assertEquals(AddBookmarkResult.InvalidUrl, repository.add(credentialedUrl, null))
        assertEquals(AddBookmarkResult.InvalidUrl, repository.add("https:// bad host/", null))
        assertEquals(AddBookmarkResult.InvalidUrl, repository.add("https://example.test/${"a".repeat(2048)}", null))
        assertTrue(repository.list().isEmpty())
    }

    @Test
    fun duplicateDetectionUsesDocumentedCanonicalUrlRules() {
        val repository = InMemoryBookmarkRepository()

        assertTrue(repository.add(" HTTPS://Example.TEST:443/a/../guide ", null) is AddBookmarkResult.Added)
        assertEquals(
            AddBookmarkResult.Duplicate,
            repository.add("https://example.test/guide", "Another label"),
        )
        assertEquals(1, repository.list().size)
    }

    @Test
    fun removesOnlyRequestedBookmarkAndListSizeIsActualCount() {
        val repository = InMemoryBookmarkRepository()
        val first = (repository.add("https://one.example", null) as AddBookmarkResult.Added).bookmark
        repository.add("https://two.example", "Two")

        assertEquals(2, repository.list().size)
        assertTrue(repository.remove(first.id))
        assertEquals(listOf("https://two.example/"), repository.list().map(Bookmark::url))
        assertEquals(1, repository.list().size)
        assertFalse(repository.remove(first.id))
    }

    @Test
    fun updateKeepsStableIdAndCreationTimeAndRejectsDuplicateUrls() {
        val repository = InMemoryBookmarkRepository()
        val first = (repository.add("https://one.example", "One") as AddBookmarkResult.Added).bookmark
        repository.add("https://two.example", "Two")

        assertEquals(
            AddBookmarkResult.Duplicate,
            repository.update(first.id, "https://two.example", "Collision"),
        )
        val updated = repository.update(first.id, "https://updated.example", " Updated ")

        assertTrue(updated is AddBookmarkResult.Updated)
        val changed = (updated as AddBookmarkResult.Updated).bookmark
        assertEquals(first.id, changed.id)
        assertEquals(first.createdAt, changed.createdAt)
        assertEquals("Updated", changed.title)
        assertTrue(changed.updatedAt >= first.updatedAt)
        assertEquals(AddBookmarkResult.NotFound, repository.update("missing", "https://one.example", null))
    }

    @Test
    fun bookmarkLimitIsEnforcedAtTheRepositoryBoundary() {
        val repository = InMemoryBookmarkRepository()
        repeat(500) { index ->
            assertTrue(
                repository.add("https://example.test/$index", null) is AddBookmarkResult.Added,
            )
        }

        assertEquals(AddBookmarkResult.LimitReached, repository.add("https://overflow.example", null))
        assertEquals(500, repository.list().size)
    }

    @Test
    fun newRepositoryAndEmptiedRepositoryHaveHonestEmptyState() {
        val repository = InMemoryBookmarkRepository()

        assertTrue(repository.list().isEmpty())
        val bookmark = (repository.add("https://example.test", null) as AddBookmarkResult.Added).bookmark
        repository.remove(bookmark.id)
        assertTrue(repository.list().isEmpty())
        assertEquals("No bookmarks yet", org.parmar.aether.ui.BookmarksCopy.EMPTY_TITLE)
        assertTrue(org.parmar.aether.ui.BookmarksCopy.EMPTY_MESSAGE.contains("Nothing will be opened"))
    }
}
