# JV Stock Issue 3.0

Android app that plans stock issues, fills the CUIMS Issue/Return form automatically, logs every slip, and keeps issue/return registers with PDFs.

## Folders
- `android/` – the app shell (WebViews, fingerprint lock, downloads, updates)
- `web/` – all screens and logic (`app.js`) and the CUIMS fill engine (`fill.js`). Changes here reach the phone instantly.
- `apps-script/Code.gs` – Google Sheet backup script
- `docs/JV-Stock-Issue-data-format.xlsx` – upload format
- `.github/workflows/` – Build APK, Deploy screens, Create signing key, Unpack ZIP

## One-time setup (phone friendly)

1. **Create the repo**: GitHub > New repository > name `jv-stock-issue` > **Public** > Create.
2. **Turn on Pages**: repo Settings > Pages > Source: **GitHub Actions**.
3. **Token for unpacking**: your profile > Settings > Developer settings > Personal access tokens > Tokens (classic) > Generate. Tick **repo** and **workflow**. Copy it.
   Then repo Settings > Secrets and variables > Actions > New repository secret: name `UNPACK_TOKEN`, value = the token.
4. **Create the unpack file**: repo > Add file > Create new file. Name: `.github/workflows/unpack.yml`. Paste the text from the box at the end of this README. Commit.
5. **Upload the ZIP**: Add file > Upload files > choose `JV-Stock-Issue-repo.zip` > Commit. In about a minute, the Unpack action spreads all files into the repo.
   (The first "Build APK" run will fail with "Signing key missing". That's expected.)
6. **Signing key**: Actions > **Create signing key (run once)** > Run workflow. Open the finished run > Artifacts > download `signing-key`. Inside:
   - `KEYSTORE_B64.txt` → add secret `KEYSTORE_B64` (paste the whole text)
   - `KEYSTORE_PASSWORD.txt` → add secret `KEYSTORE_PASSWORD`
   Keep `jv.keystore` somewhere safe (Drive). Every future update must use this same key.
7. **Build**: Actions > **Build APK** > Run workflow. After ~6 minutes: repo > Releases > latest > `JV-Stock-Issue.apk`. Install it (allow "Install unknown apps" once).
8. **Screens online**: Actions > **Deploy screens** > Run workflow (once). After that it runs by itself.

## Google Sheet backup
Open `apps-script/Code.gs`, follow the steps at its top (script.google.com > paste > Deploy as Web app, access: Anyone). Paste the `/exec` URL in the app: Settings > Google Sheet backup.

## First use in the app
1. Settings > My details (name, emp code, designation), manager line if needed, fingerprint lock.
2. Tap **Open CUIMS**, log in once. The app learns the Project Area list.
3. Upload > CUIMS stock report, then fresh requests (and your earlier pending once).
4. Home shows today's requests in order. Open one > Fill on CUIMS > enter Slip No and receiver > Start.
5. Check Selected Items and tap SUBMIT yourself. The app captures the Serial No.

## Updates
- Change anything in `web/` → live on the phone the next time the app opens (no install).
- Change anything in `android/` → a new APK release is built; the app shows **Update available** in Settings/Home; one tap to install.
- Settings > App updates > **Built-in (rollback)** switches to the screens inside the installed APK if an online change misbehaves.

## unpack.yml (paste in step 4)
```yaml
name: Unpack uploaded ZIP
on:
  push:
    branches: [main]
    paths: ['*.zip']
permissions:
  contents: write
jobs:
  unpack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.UNPACK_TOKEN }}
      - name: Unpack
        run: |
          shopt -s nullglob
          for z in *.zip; do
            unzip -o "$z" -d .
            git rm -q --cached "$z" || true
            rm -f "$z"
          done
          git config user.name "jv-bot"
          git config user.email "jv-bot@users.noreply.github.com"
          git add -A
          git commit -m "Unpack uploaded ZIP" || echo "Nothing to commit"
          git push
```
