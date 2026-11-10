package org.parmar.aether.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal suspend fun <T> onDatabaseDispatcher(block: () -> T): T =
    withContext(Dispatchers.IO) { block() }
