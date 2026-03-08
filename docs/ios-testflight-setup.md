# iOS TestFlight Setup (without a Mac)

## Prerequisites

- Apple Developer Program membership ($99/year) — https://developer.apple.com/programs/
- OpenSSL installed (`sudo apt install openssl` on Ubuntu)

## Step 1: Generate a Distribution Certificate

```bash
# Generate a private key
openssl genrsa -out ios_dist.key 2048

# Create a Certificate Signing Request (CSR)
openssl req -new -key ios_dist.key -out ios_dist.csr \
  -subj "/CN=Your Name/emailAddress=your@email.com"
```

## Step 2: Upload CSR to Apple Developer Portal

1. Go to https://developer.apple.com/account/resources/certificates/add
2. Select **Apple Distribution**
3. Upload `ios_dist.csr`
4. Download the resulting `distribution.cer`

## Step 3: Create a .p12 Bundle

```bash
# Convert Apple's .cer (DER format) to PEM
openssl x509 -inform DER -in distribution.cer -out distribution.pem

# Bundle into .p12 (set a password — you'll need it for GitHub secrets)
openssl pkcs12 -export -out distribution.p12 \
  -inkey ios_dist.key -in distribution.pem \
  -password pass:YOUR_P12_PASSWORD
```

## Step 4: Register an App ID

1. Go to https://developer.apple.com/account/resources/identifiers/add/bundleId
2. Select **App IDs** → **App**
3. Description: `SysML Studio`
4. Bundle ID (Explicit): `com.sysml-studio.app`
   - Check your `src-tauri/tauri.conf.json` for the actual bundle identifier
5. No extra capabilities needed — click **Register**

## Step 5: Create a Provisioning Profile

1. Go to https://developer.apple.com/account/resources/profiles/add
2. Select **App Store Connect** (this covers TestFlight)
3. Select the App ID you just created
4. Select the distribution certificate from Step 2
5. Name it `SysML Studio Distribution`
6. Download the `.mobileprovision` file

## Step 6: Add GitHub Secrets

1. Go to your GitHub repo → Settings → Environments
2. Create an environment called `ios-release`
3. Add these secrets:

```bash
# Generate base64 values on your Linux machine:
base64 -w 0 distribution.p12        # → APPLE_CERTIFICATE
base64 -w 0 profile.mobileprovision  # → APPLE_PROVISIONING_PROFILE
```

| Secret Name | Value |
|------------|-------|
| `APPLE_CERTIFICATE` | base64-encoded contents of `distribution.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set in Step 3 |
| `APPLE_TEAM_ID` | Your 10-character Team ID (found at developer.apple.com → Membership Details) |
| `APPLE_PROVISIONING_PROFILE` | base64-encoded contents of the `.mobileprovision` file |

## Step 7: Create the App in App Store Connect

1. Go to https://appstoreconnect.apple.com → My Apps → "+"
2. New App → iOS
3. Name: `SysML Studio`
4. Bundle ID: select the one from Step 4
5. SKU: `sysml-studio`
6. Save — this creates the TestFlight landing page

## Step 8: Trigger a Build

Push a new version tag to trigger the iOS build workflow:

```bash
git tag -a v0.X.X -m "vX.X.X: description"
git push origin v0.X.X
```

The GitHub Actions workflow will:
1. Build the iOS app with your signing certificate
2. Export a signed `.ipa`
3. Upload it as a GitHub release artifact

## Step 9: Upload to TestFlight

Currently the workflow exports the `.ipa` but doesn't auto-upload to TestFlight.

**Manual upload option:**
- Download the `.ipa` from the GitHub Actions artifacts
- Use Apple's Transporter CLI (available on Linux via `xcrun altool` won't work without macOS)
- Or use the Transporter app on any Mac

**Auto-upload option (recommended):**
To automate uploads, create an App Store Connect API Key:
1. Go to https://appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API
2. Generate a new key with "App Manager" role
3. Download the `.p8` file and note the Key ID and Issuer ID
4. Add these GitHub secrets:
   - `APP_STORE_CONNECT_API_KEY`: base64-encoded `.p8` file
   - `APP_STORE_CONNECT_KEY_ID`: the Key ID
   - `APP_STORE_CONNECT_ISSUER_ID`: the Issuer ID

Then the workflow can be updated to use `xcrun altool --upload-app` to push directly to TestFlight.

## Step 10: Test via TestFlight

1. Open TestFlight on your iPhone
2. The build will appear after Apple processes it (usually 15-30 minutes)
3. Install and test

## Security Notes

- Keep `ios_dist.key` secure — it's your private signing key
- Never commit `.p12`, `.mobileprovision`, or `.key` files to the repo
- Store them somewhere safe in case you need to regenerate secrets
