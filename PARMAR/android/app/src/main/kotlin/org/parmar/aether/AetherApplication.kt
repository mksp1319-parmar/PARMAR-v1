package org.parmar.aether

import android.app.Application
import org.parmar.aether.data.LocalAetherDatabase

class AetherApplication : Application() {
    val localDatabase: LocalAetherDatabase by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        LocalAetherDatabase(this)
    }
}
