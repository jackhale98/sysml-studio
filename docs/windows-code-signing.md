# Windows Code Signing Guide

This guide covers how to sign SysML Studio's Windows builds so that Windows SmartScreen trusts the installer and doesn't show security warnings.

## Options Overview

| Option | Cost | SmartScreen Trust | CI Friendly |
|--------|------|-------------------|-------------|
| Azure Trusted Signing | ~$10/month | Immediate | Yes |
| SSL.com eSigner (OV) | ~$200/year | Builds over time | Yes |
| DigiCert EV + KeyLocker | ~$400/year | Immediate | Yes |
| Self-signed | Free | None | Yes |

**Recommended: Azure Trusted Signing** — cheapest real option, immediate trust, native Tauri support.

---

## Option 1: Azure Trusted Signing (Recommended)

Microsoft's own code signing service. Recognized by Windows immediately.

### Setup Steps

#### 1. Create Azure Resources

1. Create an [Azure account](https://portal.azure.com)
2. In Azure Portal, search for **"Trusted Signing"**
3. Create a **Trusted Signing Account** (select your region)
4. Create a **Certificate Profile** within the account
   - Profile type: "Public Trust" for broad Windows trust
   - Choose identity validation (requires business identity verification)

#### 2. Create Azure AD App Registration

1. In Azure Portal → Azure Active Directory → App registrations → New registration
2. Name it `sysml-studio-signing`
3. Note the **Application (client) ID** and **Directory (tenant) ID**
4. Under Certificates & secrets → New client secret → copy the secret value
5. Under the Trusted Signing Account → Access control (IAM):
   - Add role assignment: **"Trusted Signing Certificate Profile Signer"**
   - Assign to the app registration you created

#### 3. Add GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `AZURE_TENANT_ID` | Directory (tenant) ID from app registration |
| `AZURE_CLIENT_ID` | Application (client) ID from app registration |
| `AZURE_CLIENT_SECRET` | Client secret value |
| `AZURE_ENDPOINT` | Trusted Signing account endpoint (e.g. `https://eus.codesigning.azure.net`) |
| `AZURE_CODE_SIGNING_ACCOUNT_NAME` | Your Trusted Signing account name |
| `AZURE_CERTIFICATE_PROFILE_NAME` | Your certificate profile name |

#### 4. Update `tauri.conf.json`

Add the Windows sign command configuration:

```json
{
  "bundle": {
    "windows": {
      "signCommand": "trusted-signing-cli sign -e %AZURE_ENDPOINT% -a %AZURE_CODE_SIGNING_ACCOUNT_NAME% -c %AZURE_CERTIFICATE_PROFILE_NAME% -d \"SysML Studio\" %1"
    }
  }
}
```

#### 5. Update GitHub Workflow

In `.github/workflows/build-desktop.yml`, add the signing tool installation and environment variables to the Windows build step:

```yaml
- name: Install Azure Trusted Signing CLI
  if: matrix.platform == 'windows-latest'
  run: dotnet tool install --global trusted-signing-cli

- name: Build Tauri app
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # Azure Trusted Signing (Windows only)
    AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
    AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
    AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
    AZURE_ENDPOINT: ${{ secrets.AZURE_ENDPOINT }}
    AZURE_CODE_SIGNING_ACCOUNT_NAME: ${{ secrets.AZURE_CODE_SIGNING_ACCOUNT_NAME }}
    AZURE_CERTIFICATE_PROFILE_NAME: ${{ secrets.AZURE_CERTIFICATE_PROFILE_NAME }}
  with:
    args: --target ${{ matrix.target }}
    tagName: v__VERSION__
    releaseName: "SysML Studio v__VERSION__"
    releaseBody: "See the assets below for download links."
    releaseDraft: true
    prerelease: false
```

---

## Option 2: SSL.com eSigner

Cloud-based OV code signing. SmartScreen trust builds over time (not immediate).

1. Purchase an OV code signing cert from [SSL.com](https://ssl.com) (~$200/year)
2. Enable eSigner for cloud signing
3. Use the [CodeSignTool](https://www.ssl.com/guide/esigner-codesigntool-command-guide/) CLI in CI
4. Set `signCommand` in `tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "signCommand": "CodeSignTool sign -username=%SSL_COM_USERNAME% -password=%SSL_COM_PASSWORD% -totp_secret=%SSL_COM_TOTP% -input_file_path=%1"
    }
  }
}
```

---

## Option 3: DigiCert EV + KeyLocker

Most expensive but immediate full SmartScreen trust.

1. Purchase an EV code signing cert from [DigiCert](https://digicert.com) (~$400/year)
2. Use DigiCert KeyLocker for cloud HSM (avoids physical USB token)
3. Install `smctl` CLI in workflow
4. Configure via Tauri's `signCommand`

---

## macOS Code Signing

The macOS builds can be signed using Apple Developer certificates. Add these secrets:

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 file |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID |

The `tauri-apps/tauri-action` automatically uses these environment variables when present.

---

## Verification

After signing, verify the signature:

**Windows (PowerShell):**
```powershell
Get-AuthenticodeSignature "SysML Studio_0.4.1_x64-setup.exe"
```

**macOS:**
```bash
codesign --verify --deep --strict "SysML Studio.app"
spctl --assess --type execute "SysML Studio.app"
```
