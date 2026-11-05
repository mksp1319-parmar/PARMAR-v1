package org.parmar.aether.ui.bookmarks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.error
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.parmar.aether.data.CreateTabResult
import org.parmar.aether.ui.theme.AetherColors
import org.parmar.aether.ui.theme.AetherSpacing

object BookmarksCopy {
    const val EMPTY_TITLE = "No bookmarks yet"
    const val EMPTY_MESSAGE =
        "Add an HTTPS address above to save it locally. Nothing will be opened or downloaded."
}

@Composable
fun BookmarksScreen(
    bookmarks: List<Bookmark>,
    addBookmark: (String, String?) -> AddBookmarkResult,
    updateBookmark: (String, String, String?) -> AddBookmarkResult,
    onRemoveBookmark: (String) -> Boolean,
    onCreateSavedUrlTab: (Bookmark) -> CreateTabResult,
    onHome: () -> Unit,
) {
    var url by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var formMessage by remember { mutableStateOf<String?>(null) }
    var selectedBookmark by remember { mutableStateOf<Bookmark?>(null) }
    var editingBookmark by remember { mutableStateOf<Bookmark?>(null) }
    var removingBookmark by remember { mutableStateOf<Bookmark?>(null) }
    val visibleBookmarks = bookmarks.filter {
        search.isBlank() ||
            it.title.contains(search, ignoreCase = true) ||
            it.url.contains(search, ignoreCase = true)
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = if (maxWidth >= 720.dp) 48.dp else AetherSpacing.large.dp),
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .widthIn(max = if (maxWidth >= 720.dp) 800.dp else Dp.Unspecified)
                .align(Alignment.TopCenter),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 24.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text(
                            text = "Bookmarks",
                            modifier = Modifier.semantics { heading() },
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "${bookmarks.size} ${if (bookmarks.size == 1) "bookmark" else "bookmarks"}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = AetherColors.textSecondary,
                        )
                    }
                    OutlinedButton(onClick = onHome) {
                        Text("Home")
                    }
                }
            }

            item {
                Text(
                    text = "Bookmarks store addresses, not page content. Saved URLs cannot be opened in this offline shell.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AetherColors.textSecondary,
                )
            }

            item {
                AddBookmarkForm(
                    url = url,
                    onUrlChange = {
                        url = it
                        formMessage = null
                    },
                    title = title,
                    onTitleChange = {
                        title = it
                        formMessage = null
                    },
                    message = formMessage,
                    isEditing = editingBookmark != null,
                    onCancelEdit = {
                        editingBookmark = null
                        url = ""
                        title = ""
                        formMessage = null
                    },
                    onAdd = {
                        val result = editingBookmark?.let {
                            updateBookmark(it.id, url, title)
                        } ?: addBookmark(url, title)
                        when (result) {
                            is AddBookmarkResult.Added, is AddBookmarkResult.Updated -> {
                                editingBookmark = null
                                url = ""
                                title = ""
                                formMessage = null
                            }
                            AddBookmarkResult.Duplicate ->
                                formMessage = "That address is already bookmarked."
                            AddBookmarkResult.InvalidUrl ->
                                formMessage = "Enter a valid credential-free HTTPS address."
                            AddBookmarkResult.TitleTooLong ->
                                formMessage = "Title must be 300 characters or fewer."
                            AddBookmarkResult.LimitReached ->
                                formMessage = "The maximum of 500 bookmarks has been reached."
                            AddBookmarkResult.NotFound ->
                                formMessage = "That bookmark no longer exists."
                        }
                    },
                )
            }

            item {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Search bookmarks") },
                    singleLine = true,
                )
            }

            if (visibleBookmarks.isEmpty()) {
                item {
                    if (bookmarks.isEmpty()) {
                        EmptyBookmarksState()
                    } else {
                        Text(
                            text = "No bookmarks match this search.",
                            color = AetherColors.textSecondary,
                        )
                    }
                }
            } else {
                items(items = visibleBookmarks, key = Bookmark::id) { bookmark ->
                    BookmarkCard(
                        bookmark = bookmark,
                        onDetails = { selectedBookmark = bookmark },
                        onEdit = {
                            editingBookmark = bookmark
                            url = bookmark.url
                            title = bookmark.title
                            formMessage = null
                        },
                        onRemove = { removingBookmark = bookmark },
                        onCreateSavedUrlTab = {
                            formMessage = when (val result = onCreateSavedUrlTab(bookmark)) {
                                is CreateTabResult.Created ->
                                    "Saved-URL tab created. Page content was not loaded."
                                CreateTabResult.LimitReached ->
                                    "The 16-tab limit has been reached."
                                is CreateTabResult.Failed -> result.message
                            }
                        },
                    )
                }
            }
            item { Spacer(modifier = Modifier.height(12.dp)) }
        }
    }

    selectedBookmark?.let { bookmark ->
        AlertDialog(
            onDismissRequest = { selectedBookmark = null },
            title = { Text(bookmark.title) },
            text = {
                Text(
                    text = bookmark.url,
                    color = AetherColors.textSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = { selectedBookmark = null }) {
                    Text("Done")
                }
            },
        )
    }

    removingBookmark?.let { bookmark ->
        AlertDialog(
            onDismissRequest = { removingBookmark = null },
            title = { Text("Remove bookmark?") },
            text = { Text("This removes the saved address only; it does not affect page content.") },
            confirmButton = {
                TextButton(onClick = {
                    if (!onRemoveBookmark(bookmark.id)) {
                        formMessage = "The bookmark could not be removed."
                    }
                    removingBookmark = null
                }) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { removingBookmark = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun AddBookmarkForm(
    url: String,
    onUrlChange: (String) -> Unit,
    title: String,
    onTitleChange: (String) -> Unit,
    message: String?,
    isEditing: Boolean,
    onCancelEdit: () -> Unit,
    onAdd: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = url,
                onValueChange = onUrlChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("HTTPS address") },
                supportingText = { Text("Stored as an address only; no website is loaded.") },
                singleLine = true,
            )
            OutlinedTextField(
                value = title,
                onValueChange = onTitleChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Title (optional)") },
                singleLine = true,
            )
            message?.let {
                Text(
                    text = it,
                    modifier = Modifier.semantics { error(it) },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Button(
                onClick = onAdd,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                Text(if (isEditing) "Save bookmark changes" else "Add bookmark")
            }
            if (isEditing) {
                OutlinedButton(
                    onClick = onCancelEdit,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Cancel edit")
                }
            }
        }
    }
}

@Composable
private fun EmptyBookmarksState() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = BookmarksCopy.EMPTY_TITLE,
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = BookmarksCopy.EMPTY_MESSAGE,
                modifier = Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = AetherColors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun BookmarkCard(
    bookmark: Bookmark,
    onDetails: () -> Unit,
    onEdit: () -> Unit,
    onRemove: () -> Unit,
    onCreateSavedUrlTab: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = AetherColors.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = bookmark.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = bookmark.url,
                style = MaterialTheme.typography.bodySmall,
                color = AetherColors.textSecondary,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(onClick = onDetails) {
                    Text("View details")
                }
                TextButton(onClick = onEdit) {
                    Text("Edit")
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(onClick = onCreateSavedUrlTab) {
                    Text("Create saved-URL tab")
                }
                TextButton(onClick = onRemove) {
                    Text("Remove bookmark")
                }
            }
        }
    }
}
