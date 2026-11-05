package org.parmar.aether.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.parmar.aether.AetherApplication
import org.parmar.aether.data.AetherStorageException
import org.parmar.aether.data.ClearResult
import org.parmar.aether.data.ClearStatus
import org.parmar.aether.data.CreateTabResult
import org.parmar.aether.ui.bookmarks.BookmarkRepository
import org.parmar.aether.ui.bookmarks.BookmarksScreen
import org.parmar.aether.ui.tabs.LocalTabsSession
import org.parmar.aether.ui.tabs.TabsScreen
import org.parmar.aether.ui.navigation.AetherDestination

@Composable
fun AetherApp() {
    val context = LocalContext.current
    val appVersion = remember(context) { installedAppVersionName(context) }
    val navController = rememberNavController()
    val scope = rememberCoroutineScope()
    val localDatabase = remember(context) {
        (context.applicationContext as AetherApplication).localDatabase
    }
    val bookmarkRepository: BookmarkRepository = localDatabase
    var tabsSession by remember { mutableStateOf(LocalTabsSession()) }
    var bookmarks by remember { mutableStateOf(emptyList<org.parmar.aether.ui.bookmarks.Bookmark>()) }
    var initialized by remember { mutableStateOf(false) }
    var storageError by remember { mutableStateOf<String?>(null) }

    suspend fun loadLocalData() {
        try {
            val storedData = withContext(Dispatchers.IO) {
                bookmarkRepository.list() to localDatabase.tabSession()
            }
            bookmarks = storedData.first
            tabsSession = storedData.second
            storageError = null
            initialized = true
        } catch (error: AetherStorageException) {
            storageError = error.message ?: "AETHER local data could not be read."
        }
    }

    fun reportStorageError(block: () -> Unit) {
        try {
            block()
            storageError = null
        } catch (error: AetherStorageException) {
            storageError = error.message ?: "AETHER local data could not be updated."
        }
    }

    LaunchedEffect(localDatabase) {
        loadLocalData()
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        if (!initialized) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
            ) {
                if (storageError == null) {
                    CircularProgressIndicator()
                    Text(
                        text = "Loading local AETHER data…",
                        modifier = Modifier.padding(top = 16.dp),
                    )
                } else {
                    Text(storageError.orEmpty())
                    androidx.compose.material3.Button(
                        onClick = { scope.launch { loadLocalData() } },
                        modifier = Modifier.padding(top = 16.dp),
                    ) {
                        Text("Retry")
                    }
                }
            }
        } else {
          Column(modifier = Modifier.fillMaxSize()) {
            storageError?.let {
                Text(
                    text = it,
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        NavHost(
            navController = navController,
            startDestination = AetherDestination.HOME.route,
            modifier = Modifier.weight(1f),
        ) {
            AetherDestination.entries.forEach { destination ->
                composable(destination.route) {
                    if (destination == AetherDestination.HOME) {
                        HomeScreen(
                            onNavigate = { target ->
                                navController.navigate(target.route) {
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.TABS) {
                        TabsScreen(
                            session = tabsSession,
                            onCreateTab = {
                                try {
                                    localDatabase.createNewTab().also { result ->
                                        if (result is CreateTabResult.Created) {
                                            tabsSession = result.session
                                        }
                                        storageError = null
                                    }
                                } catch (error: AetherStorageException) {
                                    val message = error.message ?: "A local tab could not be created."
                                    storageError = message
                                    CreateTabResult.Failed(message)
                                }
                            },
                            onCloseTab = { tabId ->
                                reportStorageError { tabsSession = localDatabase.closeTab(tabId) }
                            },
                            onActivateTab = { tabId ->
                                reportStorageError { tabsSession = localDatabase.activateTab(tabId) }
                            },
                            onTogglePin = { tabId, pinned ->
                                reportStorageError { tabsSession = localDatabase.setTabPinned(tabId, pinned) }
                            },
                            onMoveTab = { tabId, direction ->
                                reportStorageError { tabsSession = localDatabase.moveTab(tabId, direction) }
                            },
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.HISTORY) {
                        HistoryScreen(
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.DOWNLOADS) {
                        DownloadsScreen(
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.BOOKMARKS) {
                        BookmarksScreen(
                            bookmarks = bookmarks,
                            addBookmark = { url, title ->
                                var result: org.parmar.aether.ui.bookmarks.AddBookmarkResult =
                                    org.parmar.aether.ui.bookmarks.AddBookmarkResult.InvalidUrl
                                reportStorageError {
                                    result = bookmarkRepository.add(url, title)
                                    if (result is org.parmar.aether.ui.bookmarks.AddBookmarkResult.Added) {
                                        bookmarks = bookmarkRepository.list()
                                    }
                                }
                                result
                            },
                            updateBookmark = { id, url, title ->
                                var result: org.parmar.aether.ui.bookmarks.AddBookmarkResult =
                                    org.parmar.aether.ui.bookmarks.AddBookmarkResult.NotFound
                                reportStorageError {
                                    result = bookmarkRepository.update(id, url, title)
                                    if (result is org.parmar.aether.ui.bookmarks.AddBookmarkResult.Updated) {
                                        bookmarks = bookmarkRepository.list()
                                    }
                                }
                                result
                            },
                            onRemoveBookmark = { bookmarkId ->
                                var removed = false
                                reportStorageError {
                                    removed = bookmarkRepository.remove(bookmarkId)
                                    if (removed) bookmarks = bookmarkRepository.list()
                                }
                                removed
                            },
                            onCreateSavedUrlTab = { bookmark ->
                                try {
                                    localDatabase.createSavedUrlTab(bookmark.url, null).also { result ->
                                        if (result is CreateTabResult.Created) {
                                            tabsSession = result.session
                                        }
                                        storageError = null
                                    }
                                } catch (error: AetherStorageException) {
                                    val message = error.message ?: "The saved-URL tab could not be created."
                                    storageError = message
                                    CreateTabResult.Failed(message)
                                }
                            },
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.SETTINGS) {
                        SettingsScreen(
                            appVersion = appVersion,
                            onPrivacy = {
                                navController.navigate(AetherDestination.PRIVACY.route) {
                                    launchSingleTop = true
                                }
                            },
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.PRIVACY) {
                        PrivacyScreen(
                            onClearCategory = { category ->
                                try {
                                    when (category) {
                                        "Tabs" -> localDatabase.clearTabs().also {
                                            if (it.status != ClearStatus.FAILED) {
                                                tabsSession = LocalTabsSession()
                                            }
                                        }
                                        "Bookmarks" -> localDatabase.clearBookmarks().also {
                                            if (it.status != ClearStatus.FAILED) {
                                                bookmarks = emptyList()
                                            }
                                        }
                                        else -> ClearResult(
                                            category = category,
                                            status = ClearStatus.FAILED,
                                            message = "This category is not a deletion target.",
                                        )
                                    }
                                } catch (error: AetherStorageException) {
                                    ClearResult(
                                        category = category,
                                        status = ClearStatus.FAILED,
                                        message = error.message ?: "Deletion could not be confirmed.",
                                    )
                                }
                            },
                            onClearAll = {
                                listOf(
                                    "Tabs",
                                    "Bookmarks",
                                ).map { category ->
                                    try {
                                        when (category) {
                                            "Tabs" -> localDatabase.clearTabs().also {
                                                if (it.status != ClearStatus.FAILED) {
                                                    tabsSession = LocalTabsSession()
                                                }
                                            }
                                            else -> localDatabase.clearBookmarks().also {
                                                if (it.status != ClearStatus.FAILED) {
                                                    bookmarks = emptyList()
                                                }
                                            }
                                        }
                                    } catch (error: AetherStorageException) {
                                        ClearResult(
                                            category = category,
                                            status = ClearStatus.FAILED,
                                            message = error.message ?: "Deletion could not be confirmed.",
                                        )
                                    }
                                }
                            },
                            onSettings = {
                                navController.popBackStack(
                                    AetherDestination.SETTINGS.route,
                                    inclusive = false,
                                )
                            },
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else if (destination == AetherDestination.PARMAR_VOKKI) {
                        ParmarVokkiScreen(
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    } else {
                        DestinationPlaceholder(
                            destination = destination,
                            onBack = { navController.popBackStack() },
                            onHome = {
                                navController.navigate(AetherDestination.HOME.route) {
                                    popUpTo(AetherDestination.HOME.route) {
                                        inclusive = false
                                    }
                                    launchSingleTop = true
                                }
                            },
                        )
                    }
                }
            }
              }
            }
        }
    }
}
