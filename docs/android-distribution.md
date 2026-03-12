# Android Distribution Guide

This guide covers releasing SysML Studio on the Google Play Store and F-Droid.

## Overview

| Channel | Cost | Effort | Timeline | Reach |
|---------|------|--------|----------|-------|
| Google Play Store | $25 one-time | Medium | 1-2 weeks | Largest Android audience |
| GitHub Releases (APK) | Free | Low | Already via CI | Technical users |
| Self-hosted F-Droid repo | Free | Low-Medium | Days | Privacy-focused users |
| Official F-Droid | Free | High | Months | FOSS community |

**Recommended order:** Play Store first, GitHub APK releases (already in place), then self-hosted F-Droid if there's demand.

---

## Prerequisites

### Rust Android Targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
```

### Android SDK/NDK

Install via Android Studio or standalone:

```bash
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"
```

Set environment variables:

```bash
export ANDROID_HOME=$HOME/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/26.1.10909125
```

### Initialize Tauri Android

```bash
npx tauri android init
```

This creates `src-tauri/gen/android/` with the Gradle project.

---

## Building

```bash
# APK for testing / sideloading / F-Droid
npx tauri android build --apk

# AAB (Android App Bundle) for Play Store
npx tauri android build
```

Output locations:
- APK: `src-tauri/gen/android/app/build/outputs/apk/release/`
- AAB: `src-tauri/gen/android/app/build/outputs/bundle/release/`

---

## Google Play Store

### 1. Create a Signing Key

```bash
keytool -genkey -v -keystore sysml-studio.keystore -alias sysml-studio \
  -keyalg RSA -keysize 2048 -validity 10000
```

Store this keystore securely. If you lose it, you cannot update your app.

**Recommended:** Use [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756) (Google manages the release key; you only keep an upload key). This is the default for new apps.

### 2. Configure Signing in Gradle

Edit `src-tauri/gen/android/app/build.gradle.kts`:

```kotlin
android {
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "sysml-studio.keystore")
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "sysml-studio"
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}
```

### 3. Create a Play Developer Account

1. Go to [Google Play Console](https://play.google.com/console)
2. Pay the $25 one-time registration fee
3. Complete identity verification

### 4. Create the App Listing

In Play Console:
1. **Create app** -> name it "SysML Studio"
2. Fill in the **Store listing**:
   - Short description (80 chars max)
   - Full description
   - Screenshots (phone, 7" tablet, 10" tablet)
   - Feature graphic (1024x500)
   - App icon (512x512)
3. Complete the **Content rating** questionnaire
4. Set **Pricing & distribution** (free)
5. Fill in **App content** declarations (privacy policy URL, ads, target audience)

### 5. Upload and Release

1. Go to **Testing > Internal testing** -> Create new release
2. Upload the AAB file
3. Add release notes
4. Roll out to internal testers first
5. Promote through: Internal -> Closed testing -> Open testing -> Production

### 6. CI Workflow

Add an Android build job to `.github/workflows/build-desktop.yml`:

```yaml
android:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Setup Java
      uses: actions/setup-java@v4
      with:
        distribution: temurin
        java-version: 17

    - name: Setup Android SDK
      uses: android-actions/setup-android@v3

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 22

    - name: Install Rust
      uses: dtolnay/rust-toolchain@stable
      with:
        targets: aarch64-linux-android,armv7-linux-androideabi,x86_64-linux-android,i686-linux-android

    - name: Install frontend dependencies
      run: npm ci

    - name: Decode keystore
      run: echo "${{ secrets.ANDROID_KEYSTORE }}" | base64 -d > src-tauri/gen/android/sysml-studio.keystore

    - name: Build Android AAB
      run: npx tauri android build
      env:
        ANDROID_KEYSTORE_PATH: sysml-studio.keystore
        ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
        ANDROID_KEY_ALIAS: sysml-studio
        ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}

    - name: Upload to Play Store
      uses: r0adkll/upload-google-play@v1
      with:
        serviceAccountJsonPlainText: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT }}
        packageName: com.sysmlstudio.studio
        releaseFiles: src-tauri/gen/android/app/build/outputs/bundle/release/*.aab
        track: internal
        status: completed
```

#### GitHub Secrets

| Secret | Value |
|--------|-------|
| `ANDROID_KEYSTORE` | Base64-encoded .keystore file (`base64 -w0 sysml-studio.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Key alias password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | JSON service account key for Play Developer API |

#### Creating the Play Store Service Account

1. In Google Cloud Console, create a **Service Account**
2. Grant it the **Service Account User** role
3. Generate a JSON key and save it as the `GOOGLE_PLAY_SERVICE_ACCOUNT` secret
4. In Play Console -> Settings -> API access, link the service account
5. Grant it **Release manager** permissions for your app

---

## F-Droid

### Option 1: Self-Hosted F-Droid Repository (Recommended Start)

Host your own F-Droid-compatible repository. Users add your repo URL in the F-Droid app.

#### Setup

```bash
# Install fdroidserver
pip install fdroidserver

# Create repo directory
mkdir -p fdroid/repo
cd fdroid

# Initialize
fdroid init
```

#### Add Your APK

```bash
# Copy the signed release APK
cp /path/to/sysml-studio-0.4.2.apk repo/

# Generate metadata and sign the repo
fdroid update
fdroid server update  # if using rsync/SSH to deploy
```

#### Metadata File

Create `metadata/com.sysmlstudio.studio.yml`:

```yaml
Categories:
  - Development
  - Science & Education
License: MIT
AuthorName: Jack Hale
WebSite: https://github.com/jackhale98/sysml-studio
SourceCode: https://github.com/jackhale98/sysml-studio
IssueTracker: https://github.com/jackhale98/sysml-studio/issues

AutoName: SysML Studio
Summary: SysML v2 modeling studio with diagrams and MBSE analysis
Description: |
  SysML Studio is a desktop and mobile application for working with
  SysML v2 models. Features include parsing, element browsing, BDD/STM/REQ
  diagrams, traceability matrices, BOM rollups, state machine simulation,
  action flow analysis, and calculation evaluation.

CurrentVersion: 0.4.2
CurrentVersionCode: 42
```

#### Host on GitHub Pages

Add the `fdroid/repo/` directory to a `gh-pages` branch or a separate repo. Users add:

```
https://jackhale98.github.io/sysml-studio-fdroid/repo
```

as a repository in the F-Droid app.

#### CI Automation

```yaml
- name: Build APK
  run: npx tauri android build --apk

- name: Update F-Droid repo
  run: |
    cp src-tauri/gen/android/app/build/outputs/apk/release/*.apk fdroid/repo/
    cd fdroid && fdroid update
    # Deploy fdroid/repo/ to GitHub Pages
```

### Option 2: Official F-Droid Repository

Submit your app to the main F-Droid repository so it appears in the default app listings.

#### Requirements

- App must be fully open source (all dependencies too)
- Must build reproducibly from source
- No proprietary dependencies or tracking
- No non-free network services required

#### Submission Process

1. Fork [fdroiddata](https://gitlab.com/fdroid/fdroiddata) on GitLab
2. Create `metadata/com.sysmlstudio.studio.yml` with build recipe
3. Submit a merge request

#### Build Recipe

```yaml
Categories:
  - Development
  - Science & Education
License: MIT
AuthorName: Jack Hale
SourceCode: https://github.com/jackhale98/sysml-studio
IssueTracker: https://github.com/jackhale98/sysml-studio/issues

AutoName: SysML Studio
Summary: SysML v2 modeling studio

RepoType: git
Repo: https://github.com/jackhale98/sysml-studio.git

Builds:
  - versionName: 0.4.2
    versionCode: 42
    commit: v0.4.2
    subdir: src-tauri/gen/android/app
    gradle:
      - yes
    ndk: r26b
    prebuild:
      - cd ../../../..
      - rustup target add aarch64-linux-android
      - npm ci
      - npx tauri android build --apk
    scandelete:
      - src-tauri/gen/android/.gradle

AutoUpdateMode: Version
UpdateCheckMode: Tags ^v
CurrentVersion: 0.4.2
CurrentVersionCode: 42
```

#### Challenges with Tauri + F-Droid

- F-Droid's build server must compile Rust from source (slow, complex)
- Tauri's Android build process is non-standard for F-Droid's Gradle-based pipeline
- The Rust toolchain, Node.js, and npm dependencies all need to be available
- Review and build verification can take weeks to months
- Consider starting with the self-hosted repo and moving to official F-Droid once demand justifies the effort

---

## Version Code Management

Both Play Store and F-Droid require an integer `versionCode` that increments with each release. Map your semver to a version code:

| Version | Version Code |
|---------|-------------|
| 0.4.0 | 40 |
| 0.4.1 | 41 |
| 0.4.2 | 42 |
| 0.5.0 | 50 |
| 1.0.0 | 100 |

Set this in `src-tauri/gen/android/app/build.gradle.kts`:

```kotlin
android {
    defaultConfig {
        versionCode = 42
        versionName = "0.4.2"
    }
}
```

---

## Verification

After building, verify the APK:

```bash
# Check APK signature
apksigner verify --verbose sysml-studio-release.apk

# Check AAB contents
bundletool dump manifest --bundle=sysml-studio-release.aab

# Install and test on device
adb install sysml-studio-release.apk
```
