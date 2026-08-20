# Installation

Alex OS 0.1.0 supports desktop Obsidian 1.11.4 or newer.

## Option A: GitHub release

1. Open the [latest release](https://github.com/alex-slovakia/alex-os/releases/latest).
2. Download these three individual assets:
   - <code>main.js</code>
   - <code>manifest.json</code>
   - <code>styles.css</code>
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

## Option B: BRAT

1. Install the BRAT community plugin.
2. In BRAT settings, choose **Add Beta plugin**.
3. Enter <code>https://github.com/alex-slovakia/alex-os</code>.
4. Enable Alex OS under **Settings → Community plugins**.

BRAT is a third-party beta installer. Review its permissions and update behavior before use.

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
- Journal root and index
- Greeting name, density, and visible modules

The defaults use a numbered-folder convention, and the main source paths are editable. Quick navigation uses a small set of generic default destinations in 0.1.0. Missing source notes are safe: the relevant card is hidden or shows a neutral empty state.

Starter files are available in [examples](../examples/). For Daily Focus, prefer the dashboard’s **Set today’s focus** action so the note receives today’s exact local date.

## Optional Calendar setup

The dashboard works without Google. To add a read-only seven-day schedule, follow [Google Calendar setup](GOOGLE-CALENDAR-SETUP.md).

## Updating

Download the three assets from the newest release and replace the older copies in <code>.obsidian/plugins/alex-os/</code>. Reload Obsidian afterward. Keep <code>data.json</code>; it contains ordinary plugin preferences and the public OAuth client ID, not tokens.

## Uninstalling

1. Disable Alex OS in Community plugins.
2. If Calendar was connected, use **Disconnect Google** first. Use **Clear** beside the OAuth client secret if you also want to remove the stored app credential.
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

- Use a Google OAuth client of type **Desktop app**, not Web application.
- Save a matching Client ID and generated client secret.
- Keep Obsidian open until the browser redirects to <code>127.0.0.1</code>.
- Confirm the intended account is a test user while the Google app is in Testing.
- Never post the provider error together with credentials or tokens.
