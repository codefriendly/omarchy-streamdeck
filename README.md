# Omarchy OpenDeck Workspaces

Control Hyprland workspaces from a **15-button (3×5) Stream Deck with two monitors**, with live indicators for the workspace shown on each monitor, monitor focus, and window occupancy.

This project contains two components:

- An **Omarchy shell service** that watches desktop state.
- An **OpenDeck plugin** that provides workspace buttons and handles presses.

Workspace buttons use dark, blue-gray, and green backgrounds for inactive, visible, and focused workspaces. Numbers are dim when a workspace is empty and white when it contains windows. Each button targets a local workspace slot, 1–10, on a chosen monitor.

## Requirements

- A 15-button (3×5) Stream Deck and two monitors.
- Omarchy Quattro with shell plugins and monitor-local workspaces.
- Native OpenDeck 2.14.x.
- Node.js 22 or newer on OpenDeck's PATH. No npm dependencies are required.
- A private, user-owned `XDG_RUNTIME_DIR`, normally `/run/user/UID`.

Other keypad sizes and monitor layouts are not currently supported. Use a native Linux OpenDeck installation; Flatpak is not currently supported.

**Verification:** automated tests, Omarchy validation and QML lint pass. Basic live use was checked with native OpenDeck 2.14.1 and a physical 15-button deck. Inspector automation uses a fake host; live inspector and recovery testing is not comprehensive.

## Installation

Clone or download this repository. Close OpenDeck before installing its files, and stop any other application controlling the same device.

### 1. Install the OpenDeck plugin

From the repository root:

```sh
mkdir -p "$HOME/.config/opendeck/plugins"
destination="$HOME/.config/opendeck/plugins/codefriendly.streamdeck.sdPlugin"
test ! -e "$destination" && test ! -L "$destination" && \
  cp -a -T -- "$PWD/opendeck/codefriendly.streamdeck.sdPlugin" "$destination"
```

The destination must not already exist. Use a copy rather than a symlink outside OpenDeck's configuration directory: OpenDeck can reject externally linked inspector and image assets.

### 2. Install the Omarchy service

From the same repository root:

```sh
checkout="$(pwd -P)"
destination="$HOME/.config/omarchy/plugins/codefriendly.streamdeck"
mkdir -p "$HOME/.config/omarchy/plugins" &&
if [ -L "$destination" ] && [ "$(readlink -f -- "$destination")" = "$checkout" ]; then
  : # Already linked to this checkout.
elif [ ! -e "$destination" ] && [ ! -L "$destination" ]; then
  ln -sT -- "$checkout" "$destination"
else
  printf '%s\n' "Destination already exists and is not a link to this checkout: $destination" >&2
  false
fi &&
omarchy-shell shell rescanPlugins &&
omarchy plugin enable codefriendly.streamdeck
```

A correct existing link is left alone. An unrelated directory, file or symlink stops the commands before rescan or enable; inspect it rather than overwriting it. `ln -sT` prevents creating a nested link inside an existing directory.

Start OpenDeck. Under **Omarchy**, add a **Workspace** action to a button. In its settings, enter the monitor connector and workspace slot, then choose **Save target**. Find connector names with:

```sh
hyprctl monitors
```

An unconfigured button shows `?` and does not switch workspaces.

## Generate both workspace layouts

The optional generator creates two grouped OpenDeck profiles:

| Profile | Top row | Middle row | Bottom row |
|---|---|---|---|
| `Workspaces/1 to 5` | Upper monitor, workspaces 1–5 | Right chevron in column 5 | Lower monitor, workspaces 1–5 |
| `Workspaces/6 to 10` | Upper monitor, workspaces 6–10 | Left chevron in column 1 | Lower monitor, workspaces 6–10 |

Other middle-row positions are blank. The chevrons switch between the two profiles. OpenDeck uses profiles rather than separate pages within a profile; the `/` groups them in its selector.

Let OpenDeck detect your device once, then close it. Find its device directory under `~/.config/opendeck/profiles/`. From this repository, replace `DEVICE_ID` and both monitor connectors below:

```sh
node tools/profiles.mjs \
  --monitors HDMI-A-1 DP-1 \
  --output "$HOME/.config/opendeck/profiles/DEVICE_ID/Workspaces"
```

The first connector controls the top row; the second controls the bottom row. The parent device directory must exist. The generator requires a **new output directory** and never merges or overwrites existing profiles.

If a `Workspaces` group already exists, choose another name:

```sh
node tools/profiles.mjs \
  --monitors HDMI-A-1 DP-1 \
  --group Desktop \
  --output "$HOME/.config/opendeck/profiles/DEVICE_ID/Desktop"
```

To preview the generated files outside your OpenDeck configuration:

```sh
mkdir -p build/profiles
node tools/profiles.mjs --monitors HDMI-A-1 DP-1 \
  --output "$PWD/build/profiles/Workspaces"
```

Start OpenDeck and select `Workspaces/1 to 5` (or your chosen group). The navigation buttons use OpenDeck's **Switch Profile** action from its Starter Pack. Profile generation is a separate setup step; installing the plugin alone does not create profiles.

## Customize buttons

Right-click a workspace button in OpenDeck and choose **Edit**. The state selector provides six appearances:

| State | Workspace | Number |
|---|---|---|
| 1 | Inactive | Dim, empty |
| 2 | Inactive | White, occupied |
| 3 | Visible on an unfocused monitor | Dim, empty |
| 4 | Visible on an unfocused monitor | White, occupied |
| 5 | Visible on the focused monitor | Dim, empty |
| 6 | Visible on the focused monitor | White, occupied |

Change backgrounds, text colors, fonts, and sizes in that editor. Configure the target monitor and workspace in the action's settings. Workspace numbers are local slots, not global Hyprland workspace IDs.

Both navigation SVGs are included in the plugin, at 75% image scale by default. Adjust their scale in OpenDeck's editor if desired. They require no downloads.

Profiles switch manually. This plugin does not change profiles based on the focused application.

## Updating

Updating this checkout does **not** update the copied OpenDeck companion.

1. Close OpenDeck, then update or download this repository.
2. Confirm that `~/.config/opendeck/plugins/codefriendly.streamdeck.sdPlugin` is the expected copied directory, not a symlink or unrelated installation. Move it to a new, separately named backup outside OpenDeck's `plugins` directory, for example under `~/.local/state/omarchy-streamdeck/backups/`. Keeping backups outside `plugins` prevents OpenDeck from loading a duplicate plugin.
3. Repeat the OpenDeck copy command under Installation to put the new companion at the now-empty destination. Replace the folder rather than merging files.
4. Keep your existing profiles and OpenDeck settings. Do not delete or regenerate them as part of an update; generated profile defaults apply only to newly created profiles.
5. Restart OpenDeck. Keep the backup until the updated plugin works; restore it with OpenDeck closed if necessary.

The Omarchy service is linked to this checkout, so it uses the updated source. Run `omarchy-shell shell rescanPlugins` to reload it. If the shell retains an older QML component, see Troubleshooting.

## Troubleshooting

- **No Workspace action:** check that the companion folder is in OpenDeck's `plugins` directory and Node.js 22+ is available to OpenDeck, then restart OpenDeck.
- **Button shows `?`:** save a valid monitor connector and a workspace slot from 1 to 10.
- **All indicators stay inactive/dim:** check the bridge:

  ```sh
  omarchy-shell codefriendly.streamdeck status
  ```

  `connected` should be `true`. Ensure the Omarchy service is enabled and the OpenDeck companion is running. Missing monitors or a disconnected bridge produce neutral indicators.
- **Inspector stays on loading/saving:** close and reopen the action settings. A lost settings reply or concurrent edit can leave it waiting.
- **Plugin changes do not reload:** rescan Omarchy plugins first. If the shell retains an older QML component, `omarchy restart shell` clears it; this briefly refreshes the shell UI. Restart OpenDeck after updating its companion files.
- **Profile generation fails:** check that the output parent exists, the output directory is new, and its final name matches `--group` (default: `Workspaces`). A failed write may leave a partial new directory; inspect it before removing or retrying.

Windows on special workspaces do not count toward regular workspace occupancy. Grouped or hidden windows still count when Hyprland assigns them to a regular workspace.

## Removal

Disable the service:

```sh
omarchy plugin disable codefriendly.streamdeck
```

Close OpenDeck, then remove the companion folder and any workspace profile group you created. Preserve unrelated profiles. Remove the Omarchy plugin through its normal removal flow, or unlink your local checkout.

Removing the companion leaves its actions unavailable in profiles that still reference them. Disabling the Omarchy service alone leaves workspace buttons functional, but without live indicators.

## Development

From the repository root:

```sh
npm test
omarchy plugin validate .
qmllint -I "${OMARCHY_PATH:-/usr/share/omarchy}/shell" Service.qml
```

The automated tests use fake host/DOM objects and disposable files/sockets, not the live desktop or device.

The Omarchy link loads this working checkout. Leave a correct link in place, rescan plugins after changes, and use the shell-restart fallback in Troubleshooting if needed. Do not create a second link inside the installed directory.

OpenDeck loads its installed **copy**, not this working checkout. Companion changes require copying the updated files with OpenDeck closed and restarting it, as described under Updating. Prefer the copied installation over an external symlink because of OpenDeck's asset-path restrictions. Test profiles can be generated into a new directory under `build/` without touching installed profiles.

## License

MIT. The bundled chevrons are adapted from Phosphor Icons under the MIT License; their notice is included in the companion folder. See [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [SECURITY.md](SECURITY.md).
