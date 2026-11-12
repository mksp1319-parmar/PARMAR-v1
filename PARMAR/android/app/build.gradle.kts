import java.security.MessageDigest

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

val canonicalEmblem = file("../../interface/static/assets/parmar-emblem.png")
val canonicalEmblemSha256 = "d2327d8b5853a4c9dd5e43b8a776c3f91a962276b37cd1c8e136cab7db81c98d"
val verifyCanonicalEmblem = tasks.register("verifyCanonicalEmblem") {
    inputs.file(canonicalEmblem)
    doLast {
        val actual = MessageDigest.getInstance("SHA-256")
            .digest(canonicalEmblem.readBytes())
            .joinToString("") { "%02x".format(it) }
        check(actual == canonicalEmblemSha256) {
            "The source PARMAR emblem does not match the canonical asset."
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn(verifyCanonicalEmblem)
}

android {
    namespace = "org.parmar.aether"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.parmar.aether"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    sourceSets.getByName("main").assets.srcDir("../../interface/static/assets")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.navigation.compose)

    androidTestCompileOnly(
        files(
            "${android.sdkDirectory}/platforms/android-35/optional/android.test.base.jar",
            "${android.sdkDirectory}/platforms/android-35/optional/android.test.runner.jar",
        ),
    )
    testImplementation(libs.junit)
}
