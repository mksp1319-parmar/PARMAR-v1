package org.parmar.aether.ui.bookmarks

import org.parmar.aether.data.AetherDataLimits
import java.net.URI
import java.net.URISyntaxException

data class Bookmark(
    val id: String,
    val url: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long,
    val schemaVersion: Int = 1,
)

sealed interface AddBookmarkResult {
    data class Added(val bookmark: Bookmark) : AddBookmarkResult
    data class Updated(val bookmark: Bookmark) : AddBookmarkResult
    data object Duplicate : AddBookmarkResult
    data object InvalidUrl : AddBookmarkResult
    data object TitleTooLong : AddBookmarkResult
    data object LimitReached : AddBookmarkResult
    data object NotFound : AddBookmarkResult
}

interface BookmarkRepository {
    fun list(): List<Bookmark>

    fun add(url: String, title: String?): AddBookmarkResult

    fun update(id: String, url: String, title: String?): AddBookmarkResult

    fun remove(id: String): Boolean
}

class InMemoryBookmarkRepository : BookmarkRepository {
    private val bookmarks = mutableListOf<Bookmark>()

    override fun list(): List<Bookmark> = bookmarks.toList()

    override fun add(url: String, title: String?): AddBookmarkResult {
        val normalizedUrl = normalizeBookmarkUrl(url) ?: return AddBookmarkResult.InvalidUrl
        val normalizedTitle = normalizeTitle(title) ?: return AddBookmarkResult.TitleTooLong
        if (bookmarks.any { it.url == normalizedUrl }) return AddBookmarkResult.Duplicate
        if (bookmarks.size >= AetherDataLimits.MAX_BOOKMARKS) return AddBookmarkResult.LimitReached

        val timestamp = System.currentTimeMillis()
        val bookmark = Bookmark(
            id = java.util.UUID.randomUUID().toString(),
            url = normalizedUrl,
            title = normalizedTitle,
            createdAt = timestamp,
            updatedAt = timestamp,
        )
        bookmarks += bookmark
        return AddBookmarkResult.Added(bookmark)
    }

    override fun update(id: String, url: String, title: String?): AddBookmarkResult {
        val index = bookmarks.indexOfFirst { it.id == id }
        if (index < 0) return AddBookmarkResult.NotFound
        val normalizedUrl = normalizeBookmarkUrl(url) ?: return AddBookmarkResult.InvalidUrl
        val normalizedTitle = normalizeTitle(title) ?: return AddBookmarkResult.TitleTooLong
        if (bookmarks.any { it.id != id && it.url == normalizedUrl }) return AddBookmarkResult.Duplicate
        val updated = bookmarks[index].copy(
            url = normalizedUrl,
            title = normalizedTitle,
            updatedAt = System.currentTimeMillis().coerceAtLeast(bookmarks[index].updatedAt),
        )
        bookmarks[index] = updated
        return AddBookmarkResult.Updated(updated)
    }

    override fun remove(id: String): Boolean = bookmarks.removeAll { it.id == id }

    private fun normalizeTitle(title: String?): String? {
        val normalized = title?.trim()?.takeIf(String::isNotEmpty) ?: "Saved address"
        return normalized.takeIf { it.length <= AetherDataLimits.MAX_TITLE_LENGTH }
    }
}

/**
 * Canonicalizes credential-free HTTPS URLs without resolving the host or making a request.
 * Scheme/host are lowercased, port 443 is removed, dot segments are normalized,
 * and an empty path becomes "/". Query and fragment remain significant.
 */
fun normalizeBookmarkUrl(input: String): String? {
    val trimmed = input.trim()
    if (trimmed.isEmpty() || trimmed.length > AetherDataLimits.MAX_URL_LENGTH) return null

    val uri = try {
        URI(trimmed)
    } catch (_: URISyntaxException) {
        return null
    }
    if (!uri.isAbsolute || uri.isOpaque || !uri.scheme.equals("https", ignoreCase = true)) {
        return null
    }
    if (uri.rawUserInfo != null) return null

    val host = uri.host ?: return null
    val port = uri.port
    if (port == 0 || port > MAX_PORT) return null

    val normalizedHost = host.lowercase()
    val authority = buildString {
        append(normalizedHost)
        if (port != -1 && port != DEFAULT_HTTPS_PORT) {
            append(':')
            append(port)
        }
    }
    val path = uri.normalize().rawPath.orEmpty().ifEmpty { "/" }
    val canonical = buildString {
        append("https://")
        append(authority)
        append(path)
        uri.rawQuery?.let {
            append('?')
            append(it)
        }
        uri.rawFragment?.let {
            append('#')
            append(it)
        }
    }
    val asciiUrl = try {
        URI(canonical).toASCIIString()
    } catch (_: URISyntaxException) {
        return null
    }
    return asciiUrl.takeIf { it.length <= AetherDataLimits.MAX_URL_LENGTH }
}

private const val MAX_PORT = 65535
private const val DEFAULT_HTTPS_PORT = 443
