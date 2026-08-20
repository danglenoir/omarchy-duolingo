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

  property string username: ""
  property string language: ""
  property string courseId: ""

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string cacheHome: Quickshell.env("XDG_CACHE_HOME") || (home + "/.cache")
  readonly property string cachePath: cacheHome + "/omarchy-duolingo/stats.json"
  readonly property string pluginDir: decodeURIComponent(
    Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "").replace(/\/$/, ""))
  readonly property string scriptPath: pluginDir + "/Duolingo.js"
  readonly property bool available: snapshot && snapshot.ok === true

  signal updated()

  property bool _refreshPending: false
  property bool _pendingForce: false

  function queueRefresh(force) {
    _pendingForce = _pendingForce || force === true
    if (!_refreshPending) {
      _refreshPending = true
      Qt.callLater(function() {
        _refreshPending = false
        var doForce = _pendingForce
        _pendingForce = false
        service.refresh(doForce)
      })
    }
  }

  onUsernameChanged: service.queueRefresh(true)
  onLanguageChanged: service.queueRefresh(true)
  onCourseIdChanged: service.queueRefresh(true)

  function refresh(force) {
    if (!service.username) {
      loading = false
      snapshot = {
        ok: false,
        configured: false,
        stale: false,
        error: "Add your Duolingo username in settings.",
        errorCode: "not_configured"
      }
      updated()
      return
    }

    if (poll.running) {
      refreshQueued = true
      queuedForce = queuedForce || force === true
      return
    }

    var command = [
      "node",
      service.scriptPath,
      "--username", service.username,
      "--language", service.language,
      "--course-id", service.courseId,
      "--cache", service.cachePath,
      "--max-age", "60"
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

  Component.onCompleted: service.queueRefresh(true)

  Process {
    id: poll
    running: false

    stdout: StdioCollector {
      id: stdoutCollector
      waitForEnd: true
      onStreamFinished: service.consume(stdoutCollector.text)
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
