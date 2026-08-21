# Installation

Alex OS 0.2.1 implements the full local dashboard for Obsidian 1.13.0 or newer on desktop, iPhone, iPad, and Android.

Automated bundle and runtime checks cover mobile loading and Calendar cache behavior. Manual verification on physical iPhone, iPad, and Android devices remains pending in the release checklist.

## Option A: Community Plugins

1. Open **Settings → Community plugins**.
2. Turn on Community plugins if prompted.
3. Choose **Browse** and search for **Alex OS**.
4. Choose **Install**, then **Enable**.

Alex OS is listed in the [Obsidian Community Plugins directory](https://community.obsidian.md/plugins/alex-os).

## Option B: GitHub release

Use this option for a manual desktop installation.

1. Open the [latest release](https://github.com/alex-slovakia/alex-os/releases/latest).
2. Download these three individual assets:
   - <code>main.js</code>
   - <code>manifest.json</code>
   - <code>styles.css</code>

   GitHub publishes artifact attestations for <code>main.js</code> and <code>styles.css</code>. Advanced users can verify a downloaded asset with <code>gh attestation verify &lt;file&gt; --repo alex-slovakia/alex-os</code>.
3. Open your vault folder in the system file manager.
4. Show hidden files if necessary.
5. Create <code>.obsidian/plugins/alex-os/</code>.
6. Put the three files directly inside it:

   ~~~text
   <Vault>/
     .obsidian/
       plugins/
         alex-os/
           main.js
           manifest.json
           styles.css
   ~~~

7. Reload Obsidian.
8. Open **Settings → Community plugins** and enable **Alex OS**.

## Option C: BRAT

1. Install the BRAT community plugin.
2. In BRAT settings, choose **Add Beta plugin**.
3. Enter <code>https://github.com/alex-slovakia/alex-os</code>.
4. Enable Alex OS under **Settings → Community plugins**.

BRAT is a third-party beta installer. Review its permissions and update behavior before use. Community Plugins is the recommended route on mobile.

## Create the dashboard

Create or open <code>Home.md</code> and add:

~~~~markdown
```alex-os-dashboard
```
~~~~

Switch to Reading view. Alex OS can automatically open the configured Home note in Reading view; disable that behavior in settings if you prefer.

## Configure your vault

Open **Settings → Alex OS** and set:

- Home note
- Input folder
- Project folders
- Daily focus folder
- Inspiration note
- Book highlights folder
- Journal root and index
- Greeting name, density, and visible modules

The defaults use a numbered-folder convention, and the main source paths are editable. Quick navigation uses a small set of generic default destinations.

Missing source notes are safe: the relevant card is hidden or shows a neutral empty state.

Starter files are available in [examples](../examples/), including an inspiration quote pool and a synthetic book-highlights note. Use at least two entries in each pool for daily changes. For Daily Focus, prefer the dashboard’s **Set today’s focus** action so the note receives today’s exact local date.

## Optional Calendar setup

The dashboard works without Google on every supported platform. Google authorization and direct synchronization are desktop-only.

After desktop sync, a vault sync provider can carry the reduced Calendar cache to mobile. Mobile Alex OS reads that cache but never contacts Google or reads Calendar secrets from SecretStorage.

Select visible calendars on desktop before refreshing. That desktop selection determines which calendars contribute reduced private display data to the mobile cache.

Follow [Google Calendar setup](GOOGLE-CALENDAR-SETUP.md) to configure the optional desktop connection.

## Updating

Community Plugins reports available updates in Obsidian. Install the update there, then reload the app if prompted.

For a manual desktop installation, replace the three plugin assets with files from the newest release. Keep <code>data.json</code>; it contains preferences and the public OAuth client ID, not tokens.

## Uninstalling

1. Disable Alex OS in Community plugins.
2. On the connected desktop, use **Disconnect Google** first. Use **Clear** beside the OAuth client secret if you also want to remove the stored app credential.
3. Remove <code>.obsidian/plugins/alex-os/</code>.
4. Optionally remove the configured Calendar cache file and dashboard fence.

Your Markdown notes remain intact.

## Troubleshooting

### The fence is visible instead of the dashboard

- Confirm Alex OS is enabled.
- Confirm the fence name is exactly <code>alex-os-dashboard</code>.
- Switch to Reading view.
- Open the developer console and look for an Alex OS error with private details redacted.

### Cards are empty

- Confirm the paths in **Settings → Alex OS**.
- Use the frontmatter examples in the README.
- Active projects require both <code>type: project</code> and <code>status: active</code>.

### Calendar will not connect

- Connect from desktop Obsidian. Mobile and iPad intentionally provide no Google OAuth or direct API sync.
- Use a Google OAuth client of type **Desktop app**, not Web application.
- Save a matching Client ID and generated client secret.
- Keep Obsidian open until the browser redirects to <code>127.0.0.1</code>.
- Confirm the intended account is a test user while the Google app is in Testing.
- Never post the provider error together with credentials or tokens.

### Calendar is stale on mobile or iPad

- Refresh Calendar on the connected desktop.
- Confirm your vault sync provider includes the configured Calendar cache path.
- Wait for vault synchronization, then reload the cache in Alex OS on mobile.
- Treat the cache as private because event titles, labels, and locations can contain personal text.
