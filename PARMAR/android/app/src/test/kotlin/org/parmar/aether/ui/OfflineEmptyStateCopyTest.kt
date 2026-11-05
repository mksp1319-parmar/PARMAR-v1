package org.parmar.aether.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineEmptyStateCopyTest {
    @Test
    fun historyExplainsThatNoVisitsAreRecorded() {
        assertEquals(
            "No browsing history has been recorded in this offline shell.",
            OfflineEmptyStateCopy.HISTORY,
        )
    }

    @Test
    fun downloadsExplainsThatTheShellDoesNotDownloadFiles() {
        assertEquals(
            "No browser downloads. This shell does not download pages or files.",
            OfflineEmptyStateCopy.DOWNLOADS,
        )
    }
}
