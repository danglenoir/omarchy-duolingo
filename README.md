# Omarchy Duolingo

An Omarchy Shell bar widget for your Duolingo streak and learning stats.

The bar shows Duo's mark and your current streak. When today's lesson is still outstanding, both turn urgent red, the count becomes bold, and an exclamation mark is added. Click the widget for course XP, total XP, currencies, energy or hearts, and league standing.

## Requirements

- Omarchy 4.0 or newer with the Quickshell-based Omarchy Shell
- Python 3
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

Create the private user configuration from the included example:

```bash
install -Dm600 \
  ~/.config/omarchy/plugins/danglenoir.duolingo/config.example.json \
  ~/.config/omarchy/duolingo.json
```

Edit `~/.config/omarchy/duolingo.json`:

```json
{
  "username": "your-duolingo-username",
  "language": "es",
  "courseId": "",
  "jwt": ""
}
```

Configuration fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `username` | Yes | Your exact Duolingo username. |
| `language` | No | Learning-language code such as `es`, `de`, or `ja`. The matching course is shown. |
| `courseId` | No | Exact Duolingo course ID. This takes priority over `language`. |
| `jwt` | No | Your own `jwt_token`, required for private values such as gems and energy/hearts. |

If both course selectors are blank, the active course is used when Duolingo returns it; otherwise the course with the most XP is shown. A Duolingo streak belongs to the whole account, not one language. The selected course supplies the language name and course XP shown next to that streak.

List the course IDs available on a public profile:

```bash
curl -fsSL "https://www.duolingo.com/2017-06-30/users?username=YOUR_USERNAME" \
  | jq '.users[0].courses[] | {id, title, learningLanguage}'
```

The configuration file is watched and reloads automatically. To force a shell reload:

```bash
omarchy restart shell
```

### Private account stats

The username-only configuration provides the streak, daily completion state, course XP, total XP, and available league information. Gems and energy/hearts are private account fields and require a Duolingo session token.

1. Sign in at `https://www.duolingo.com`.
2. Open the browser developer tools.
3. Under **Application** or **Storage**, open the cookies for `https://www.duolingo.com`.
4. Copy the value of the `jwt_token` cookie into the `jwt` field.
5. Protect the file with `chmod 600 ~/.config/omarchy/duolingo.json`.

The token is sent only to account endpoints on `www.duolingo.com`; the public league request does not receive it. It is not written to the widget cache or to `shell.json`. Treat it like a password and replace it when the panel reports that Duolingo rejected it.

Duolingo no longer returns Lingots for many accounts, and weekly position or XP appears only while the account belongs to an active league cohort. The panel displays `-` when Duolingo does not provide a value; it does not convert missing data to zero.

### Refresh interval

The default refresh interval is 10 minutes. Change it through the bar configuration:

```bash
omarchy bar set danglenoir.duolingo refreshIntervalMinutes 15 --json
```

Middle-clicking the bar widget or pressing the refresh button in the panel requests fresh data immediately.

## Troubleshooting

Run the data adapter directly to inspect its normalized output:

```bash
python3 ~/.config/omarchy/plugins/danglenoir.duolingo/scripts/duolingo_api.py \
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

Optionally remove the private configuration, session token, and cached stats:

```bash
rm -f ~/.config/omarchy/duolingo.json
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
