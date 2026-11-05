package org.parmar.aether.ui

import androidx.compose.runtime.Composable

@Composable
fun DownloadsScreen(onHome: () -> Unit) {
    OfflineEmptyStateScreen(
        title = "Downloads",
        emptyMessage = OfflineEmptyStateCopy.DOWNLOADS,
        onHome = onHome,
    )
}
