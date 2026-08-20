import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: service

  property int refreshIntervalMinutes: 10
  property bool loading: false
  property bool refreshQueued: false
  property bool queuedForce: false
  property bool receivedOutput: false
  property var snapshot: ({
    ok: false,
    configured: false,
    stale: false,
    error: "Loading Duolingo...",
    errorCode: "loading"
  })

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || (home + "/.config")
  readonly property string cacheHome: Quickshell.env("XDG_CACHE_HOME") || (home + "/.cache")
  readonly property string configPath: configHome + "/omarchy/duolingo.json"
  readonly property string cachePath: cacheHome + "/omarchy-duolingo/stats.json"
  readonly property string pluginDir: decodeURIComponent(
    Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "").replace(/\/$/, ""))
  readonly property string scriptPath: pluginDir + "/scripts/duolingo_api.py"
  readonly property bool available: snapshot && snapshot.ok === true

  signal updated()

  function refresh(force) {
    if (poll.running) {
      refreshQueued = true
      queuedForce = queuedForce || force === true
      return
    }

    var command = [
      "python3",
      service.scriptPath,
      "--config",
      service.configPath,
      "--cache",
      service.cachePath,
      "--max-age",
      "60"
    ]
    if (force === true) command.push("--force")
    receivedOutput = false
    loading = true
    poll.command = command
    poll.running = true
  }

  function consume(raw) {
    receivedOutput = true
    loading = false
    var text = String(raw || "").trim()
    if (text === "") {
      snapshot = {
        ok: false,
        configured: true,
        stale: false,
        error: "The Duolingo data helper returned no output.",
        errorCode: "empty_response"
      }
      updated()
      return
    }

    try {
      snapshot = JSON.parse(text)
    } catch (error) {
      snapshot = {
        ok: false,
        configured: true,
        stale: false,
        error: "The Duolingo data helper returned unreadable output.",
        errorCode: "invalid_response"
      }
    }
    updated()
  }

  function finishPoll() {
    loading = false
    if (!receivedOutput) consume("")
    if (!refreshQueued) return

    var force = queuedForce
    refreshQueued = false
    queuedForce = false
    Qt.callLater(function() { service.refresh(force) })
  }

  FileView {
    id: configFile
    path: service.configPath
    watchChanges: true
    printErrors: false
    preload: true
    onFileChanged: reload()
    onLoaded: service.refresh(true)
    onLoadFailed: service.refresh(true)
  }

  Process {
    id: poll
    running: false

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: service.consume(this.text)
    }

    onExited: Qt.callLater(service.finishPoll)
  }

  Timer {
    interval: Math.max(1, service.refreshIntervalMinutes) * 60 * 1000
    running: true
    repeat: true
    onTriggered: service.refresh(false)
  }
}
