FROM mcr.microsoft.com/devcontainers/base@sha256:d94c97dd9cacf183d0a6fd12a8e87b526e9e928307674ae9c94139139c0c6eae

ARG TEMURIN_RELEASE_TAG=jdk-17.0.21%2B9
ARG TEMURIN_ARCHIVE=OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz
ARG TEMURIN_SHA256=8b9b611d917e3dfd8419d3566b5949226f69b052fed7e109c1368add1dfe8711
ARG ANDROID_COMMANDLINE_TOOLS_REVISION=16111833
ARG ANDROID_COMMANDLINE_TOOLS_SHA1=e025545c62a8e64c7559119566a569fb1dec5f60
ARG ANDROID_PLATFORM_TOOLS_REVISION=37.0.3
ARG ANDROID_PLATFORM_TOOLS_SHA1=e1579b288a7ae4e9bc28dedec6a154d78b3c04ed

ENV JAVA_HOME=/opt/java/temurin-17.0.21+9
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=${JAVA_HOME}/bin:${ANDROID_HOME}/cmdline-tools/23.0/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/35.0.0:${PATH}

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    mkdir -p "$JAVA_HOME"; \
    curl --fail --location --retry 3 \
        "https://github.com/adoptium/temurin17-binaries/releases/download/${TEMURIN_RELEASE_TAG}/${TEMURIN_ARCHIVE}" \
        --output /tmp/temurin-jdk.tar.gz; \
    printf '%s  %s\n' "$TEMURIN_SHA256" /tmp/temurin-jdk.tar.gz | sha256sum --check -; \
    tar -xzf /tmp/temurin-jdk.tar.gz --strip-components=1 -C "$JAVA_HOME"; \
    rm /tmp/temurin-jdk.tar.gz

RUN set -eux; \
    mkdir -p "$ANDROID_HOME/cmdline-tools/23.0" /tmp/android-tools; \
    curl --fail --location --retry 3 \
        "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMANDLINE_TOOLS_REVISION}_latest.zip" \
        --output /tmp/android-commandline-tools.zip; \
    printf '%s  %s\n' "$ANDROID_COMMANDLINE_TOOLS_SHA1" /tmp/android-commandline-tools.zip | sha1sum --check -; \
    unzip -q /tmp/android-commandline-tools.zip -d /tmp/android-tools; \
    mv /tmp/android-tools/cmdline-tools/* "$ANDROID_HOME/cmdline-tools/23.0/"; \
    rm -rf /tmp/android-tools /tmp/android-commandline-tools.zip; \
    yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null; \
    sdkmanager --sdk_root="$ANDROID_HOME" --install \
        'platforms;android-35' \
        'build-tools;34.0.0' \
        'build-tools;35.0.0'; \
    mkdir -p /tmp/platform-tools; \
    curl --fail --location --retry 3 \
        "https://dl.google.com/android/repository/platform-tools_r${ANDROID_PLATFORM_TOOLS_REVISION}-linux.zip" \
        --output /tmp/android-platform-tools.zip; \
    printf '%s  %s\n' "$ANDROID_PLATFORM_TOOLS_SHA1" /tmp/android-platform-tools.zip | sha1sum --check -; \
    unzip -q /tmp/android-platform-tools.zip -d /tmp/platform-tools; \
    rm -rf "$ANDROID_HOME/platform-tools"; \
    mv /tmp/platform-tools/platform-tools "$ANDROID_HOME/platform-tools"; \
    rm -rf /tmp/platform-tools /tmp/android-platform-tools.zip; \
    test -d "$ANDROID_HOME/platforms/android-35"; \
    test -d "$ANDROID_HOME/build-tools/34.0.0"; \
    test -d "$ANDROID_HOME/platform-tools"; \
    test -x "$ANDROID_HOME/build-tools/35.0.0/aapt"; \
    chown -R vscode:vscode /opt/java "$ANDROID_HOME"