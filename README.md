# Omarchy Duolingo

An Omarchy Shell bar widget for your Duolingo streak and learning stats.

The bar shows Duo's mark and your current streak. When today's lesson is still outstanding, both turn urgent red, the count becomes bold, and an exclamation mark is added. Click the widget for course XP, total XP, and league standing.

## Requirements

- Omarchy 4.0 or newer with the Quickshell-based Omarchy Shell
- Node.js (v18 or newer)
- A public Duolingo profile
- Internet access to `duolingo.com` and `duolingo-leaderboards-prod.duolingo.com`

Duolingo does not provide a supported public developer API for this use case. This plugin reads the same website endpoints used by Duolingo and may need updates when those responses change.

## Install

Install and enable the plugin through Omarchy:

```bash
omarchy plugin add https://github.com/danglenoir/omarchy-duolingo.git --enable
```

The widget is added to the right section of the bar. Move it when needed:

```bash
omarchy bar move danglenoir.duolingo --section right
```

### Local development install

From a local checkout, link the repository into the user plugin directory:

```bash
mkdir -p ~/.config/omarchy/plugins
ln -s "$PWD" ~/.config/omarchy/plugins/danglenoir.duolingo
omarchy-shell shell rescanPlugins
omarchy plugin enable danglenoir.duolingo
```

## Configure

The widget can be configured directly from the Omarchy Shell UI!

1. Click the Duolingo widget on your bar to open the popup panel.
2. Click the gear icon (󰒓) in the top-right corner to open the Settings form.
3. Enter your **Duolingo username**, and optionally a **Language code** (such as `es`, `de`, or `ja`) or exact **Course ID**.
4. Click **Save** (󰆓). The settings are persisted directly within your Omarchy Shell configuration (`shell.json`).

Configuration fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `username` | Yes | Your exact Duolingo username. |
| `language` | No | Learning-language code such as `es`, `de`, or `ja`. The matching course is shown. |
| `courseId` | No | Exact Duolingo course ID. This takes priority over `language`. |

If both course selectors are blank, the active course is used when Duolingo returns it; otherwise the course with the most XP is shown. A Duolingo streak belongs to the whole account, not one language. The selected course supplies the language name and course XP shown next to that streak.

List the course IDs available on a public profile:

```bash
curl -fsSL "https://www.duolingo.com/2017-06-30/users?username=YOUR_USERNAME" \
  | jq '.users[0].courses[] | {id, title, learningLanguage}'
```

To force a shell reload:

```bash
omarchy restart shell
```

### Refresh interval

The default refresh interval is 10 minutes. Change it through the bar configuration:

```bash
omarchy bar set danglenoir.duolingo refreshIntervalMinutes 15 --json
```

Middle-clicking the bar widget or pressing the refresh button in the panel requests fresh data immediately.

## Troubleshooting

Run the data adapter directly to inspect its normalized output:

```bash
node ~/.config/omarchy/plugins/danglenoir.duolingo/Duolingo.js \
  --force --pretty
```

Useful Omarchy checks:

```bash
omarchy plugin validate ~/.config/omarchy/plugins/danglenoir.duolingo
omarchy plugin list --json
omarchy-shell shell rescanPlugins
```

Successful responses are cached in `~/.cache/omarchy-duolingo/stats.json`. If Duolingo is temporarily unreachable, the panel keeps the last successful snapshot and marks it as cached.

## Update

```bash
omarchy plugin update danglenoir.duolingo
```

## Uninstall

Remove the widget and plugin checkout:

```bash
omarchy plugin remove danglenoir.duolingo
```

Optionally remove the cached stats:

```bash
rm -rf ~/.cache/omarchy-duolingo
```

For a local development symlink, disable the widget first, then remove the link:

```bash
omarchy plugin disable danglenoir.duolingo
rm ~/.config/omarchy/plugins/danglenoir.duolingo
omarchy-shell shell rescanPlugins
```

## License

MIT
