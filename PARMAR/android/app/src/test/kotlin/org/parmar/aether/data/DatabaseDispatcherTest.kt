package org.parmar.aether.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Test

class DatabaseDispatcherTest {
    @Test
    fun databaseOperationsRunOffTheCallingThreadAndReturnTheirResult() = runBlocking {
        val callingThread = Thread.currentThread()

        val (operationThread, result) = onDatabaseDispatcher {
            Thread.currentThread() to "complete"
        }

        assertNotSame(callingThread, operationThread)
        assertEquals("complete", result)
    }
}
