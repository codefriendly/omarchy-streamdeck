# Third-party interfaces

This repository's implementation, profile generator and authored SVG assets are MIT licensed; see LICENSE. No third-party implementation, font, SDK library or npm package is bundled.

## Bundled navigation icons

`chevron-right.svg` and `chevron-left.svg` adapt [Phosphor Icons' caret-right-bold](https://github.com/phosphor-icons/core/blob/main/assets/bold/caret-right-bold.svg), by Phosphor Icons, under the MIT License. The full notice is included in `opendeck/codefriendly.streamdeck.sdPlugin/LICENSE.phosphor`. Adaptations set an explicit white fill and button padding; the left icon mirrors the same geometry.

Runtime dependencies are distributed separately under their own licenses:

- OpenDeck: https://github.com/nekename/OpenDeck (GPL-3.0-or-later). The plugin and portable profile formats were checked against v2.14.2 source, including action lifecycle, native states, simplified profiles and the built-in Switch Profile action.
- OpenAction protocol: https://openaction.amankhanna.me/ . Messages use OpenDeck's compatible plugin registration/lifecycle interface.
- Omarchy: https://github.com/basecamp/omarchy . Uses its shell plugin contract and monitor-local workspace helper.
- Quickshell: https://quickshell.org/ . Provides native Hyprland state and local socket/file APIs inside the shell.
- Node.js: https://nodejs.org/ . Uses built-in APIs only, including the WebSocket client.

The generated navigation buttons reference OpenDeck's separately installed Starter Pack Switch Profile action. They do not bundle its executable, HTML or images. System-installed fonts are selected by name, not included.

This project is unofficial and not affiliated with Elgato or the upstream projects above.
