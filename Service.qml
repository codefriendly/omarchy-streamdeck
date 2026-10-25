import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "DesktopState.js" as DesktopState

Item {
  id: root
  visible: false
  property var manifest: null
  property var shell: null
  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR")
  readonly property string stateDir: Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state"
  property var blocks: ({})
  property int sent: 0

  readonly property var desktop: {
    var monitors = [];
    var nativeMonitors = Hyprland.monitors.values;
    for (var i = 0; i < Math.min(nativeMonitors.length, 32); i++) {
      var monitor = nativeMonitors[i];
      monitors.push({name: monitor.name, focused: monitor.focused,
        workspace: monitor.activeWorkspace ? monitor.activeWorkspace.id : -1});
    }
    var counts = {};
    var windows = Hyprland.toplevels.values;
    for (var j = 0; j < Math.min(windows.length, 4096); j++) {
      var workspace = windows[j].workspace;
      if (workspace && workspace.id > 0 && workspace.id <= 100010)
        counts[workspace.id] = (counts[workspace.id] || 0) + 1;
    }
    return {version: 1, monitors: monitors, blocks: blocks, counts: counts};
  }
  onDesktopChanged: coalesce.restart()

  function publish() {
    if (!bridge.connected) return;
    var text = JSON.stringify(desktop);
    if (text.length > 60000) return;
    bridge.write(text + "\n");
    bridge.flush();
    sent++;
  }

  FileView {
    path: root.stateDir + "/omarchy/monitor-workspaces"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.blocks = DesktopState.parseBlocks(text())
    onLoadFailed: root.blocks = ({})
  }

  Socket {
    id: bridge
    path: root.runtimeDir ? root.runtimeDir + "/omarchy-streamdeck/bridge.sock" : ""
    onConnectionStateChanged: if (connected) root.publish()
  }
  Timer { id: coalesce; interval: 30; onTriggered: root.publish() }
  Timer {
    interval: 2000
    running: root.runtimeDir !== ""
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      if (bridge.connected) root.publish();
      else bridge.connected = true;
    }
  }
  Component.onDestruction: bridge.connected = false

  IpcHandler {
    target: "codefriendly.streamdeck"
    function status(): string {
      return JSON.stringify({connected: bridge.connected, sent: root.sent,
        error: root.runtimeDir ? "" : "XDG_RUNTIME_DIR is unavailable"});
    }
    function refresh(): string {
      root.publish();
      return bridge.connected ? "ok" : "disconnected";
    }
  }
}
