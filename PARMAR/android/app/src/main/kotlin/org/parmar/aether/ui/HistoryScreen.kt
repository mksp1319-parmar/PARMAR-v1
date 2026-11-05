package org.parmar.aether.ui

import androidx.compose.runtime.Composable

@Composable
fun HistoryScreen(onHome: () -> Unit) {
    OfflineEmptyStateScreen(
        title = "History",
        emptyMessage = OfflineEmptyStateCopy.HISTORY,
        onHome = onHome,
    )
}
