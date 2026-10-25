# Security

The Omarchy service runs inside the desktop shell, and the OpenDeck companion runs as a Node.js process managed by OpenDeck. Both run with your user account's permissions; they are not sandboxed. Install them only from a source you trust.

## Access and privacy

- Desktop snapshots contain monitor connector names, workspace IDs, focus state and window counts—not window titles or application contents.
- Communication stays local: an owner-only Unix socket under `XDG_RUNTIME_DIR` connects the two components, and the companion uses OpenDeck's loopback WebSocket. No remote service, analytics or runtime downloads are used.
- Releasing a configured workspace button runs `hyprctl` with a validated monitor and workspace slot. Commands use an argument array, not a shell. Desktop-state messages only update indicators; they do not execute commands.
- The profile generator writes a new directory and refuses to merge into or overwrite an existing one. Installed profiles and OpenDeck's saved settings remain until you explicitly remove them.

## Trust boundaries

The runtime socket requires private, user-owned directories. Messages and settings are validated and size-limited. These controls do not protect against a hostile process running as the same user.

OpenDeck, Quickshell, Node.js, local configuration, environment paths and the `hyprctl` executable on PATH are trusted. Quickshell reads the monitor mapping file before the plugin applies its size check; that check cannot prevent memory exhaustion from a malicious local file.

## Limitations

- A successful state update is not confirmation that the physical display rendered it. When desktop data is unavailable, indicators fall back to inactive/empty.
- A missing settings reply or concurrent settings edit can leave the inspector waiting. Close and reopen its settings to recover.
- One OpenDeck instance and one desktop producer per user are supported. Multiple sessions sharing the same user account are not supported.

Do not include credentials, private profile contents or unredacted logs in public issue reports. Testing and code review do not constitute a security guarantee.
