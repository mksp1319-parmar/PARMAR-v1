package org.parmar.aether

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.parmar.aether.ui.AetherApp
import org.parmar.aether.ui.theme.AetherTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AetherTheme {
                AetherApp()
            }
        }
    }
}
