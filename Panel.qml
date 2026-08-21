pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Effects
import QtQuick.Controls
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "danglenoir.duolingo"
  manageIpc: false

  readonly property bool vertical: bar ? bar.vertical : false
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color accent: Color.accent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property var snapshot: stats.snapshot || ({})
  readonly property bool dataReady: snapshot.ok === true
  readonly property var streak: dataReady && snapshot.streak
    ? snapshot.streak
    : ({ days: 0, todayDone: false, atRisk: false })
  readonly property int streakDays: Number(streak.days) || 0
  readonly property bool todayDone: streak.todayDone === true
  readonly property bool atRisk: streak.atRisk === true
  readonly property string languageName: dataReady && snapshot.course && snapshot.course.title
    ? remoteText(snapshot.course.title)
    : "your course"

  property bool showingSettings: false
  property bool settingsLoaded: false
  property string username: ""
  property string language: ""
  property string courseId: ""

  onSettingsChanged: syncSettings()

  Component.onCompleted: syncSettings()

  function syncSettings() {
    root.username = String(root.setting("username", "") || "").trim()
    root.language = String(root.setting("language", "") || "").trim()
    root.courseId = String(root.setting("courseId", "") || "").trim()
    root.settingsLoaded = true

    if (root.showingSettings) root.populateSettingsForm()
  }

  function persistSettings(values) {
    var entry = Object.assign({ id: root.moduleName }, root.settings, values)
    entry.id = root.moduleName

    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function") {
      root.bar.shell.updateEntryInline(root.moduleName, entry)
    }
  }

  function openSettings() {
    root.showingSettings = true
    root.populateSettingsForm()
    Qt.callLater(function() {
      usernameField.forceActiveFocus()
      usernameField.selectAll()
    })
  }

  function closeSettings() {
    root.showingSettings = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function populateSettingsForm() {
    usernameField.text = root.username
    languageField.text = root.language
    courseIdField.text = root.courseId
  }

  function saveSettings() {
    root.persistSettings({
      username: String(usernameField.text || "").trim(),
      language: String(languageField.text || "").trim(),
      courseId: String(courseIdField.text || "").trim()
    })
    root.showingSettings = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function remoteText(value) {
    var text = String(value == null ? "" : value)
    text = text.replace(/<[^>]*>/g, "").replace(/[<>]/g, "")
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
    text = text.replace(/\[[^\]]+\]:\s*\S+/g, "")
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    text = text.replace(/\b(?:https?|file|data|qrc):\/\/[^\s)]+/gi, "")
    text = text.replace(/(^|[\s(])\/\/[^\s)]+/g, "$1")
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    text = text.replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    text = text.replace(/\s+/g, " ").trim()
    if (text.length > 200)
      text = text.substring(0, 200)
    return text
  }

  function formatNumber(value) {
    if (value === undefined || value === null || value === "") return "-"
    var number = Number(value)
    if (!isFinite(number)) return "-"
    return Math.round(number).toLocaleString(Qt.locale("en_US"), "f", 0)
  }

  function dayWord(days) {
    return Number(days) === 1 ? "day" : "days"
  }

  function updatedLabel() {
    if (!dataReady || !snapshot.fetchedAt) return ""
    var date = new Date(snapshot.fetchedAt)
    if (isNaN(date.getTime())) return ""
    return "Updated " + Qt.formatDateTime(date, "HH:mm")
  }

  function barTooltip() {
    if (!dataReady) {
      if (stats.loading) return "Loading your Duolingo streak..."
      if (snapshot.errorCode === "not_configured")
        return "Configure your Duolingo profile to show your streak."
      return "Duolingo stats are unavailable."
    }
    if (atRisk) {
      return "Complete a lesson today to protect your "
        + formatNumber(streakDays) + "-" + dayWord(streakDays) + " streak!"
    }
    if (streakDays === 0) {
      return "Complete a lesson today to begin a Duolingo streak."
    }
    return "Your current Duolingo streak is "
      + formatNumber(streakDays) + " " + dayWord(streakDays) + "."
  }

  function statusText() {
    if (todayDone) return "Today's " + languageName + " lesson is complete."
    if (atRisk) return "Complete today's " + languageName + " lesson to protect your streak."
    return "You have not completed a " + languageName + " lesson today."
  }

  function refresh(force) {
    stats.refresh(force === true)
  }

  onOpenedChanged: if (opened) refresh(false)

  DuolingoService {
    id: stats
    refreshIntervalMinutes: Math.min(
      60,
      Math.max(1, parseInt(root.setting("refreshIntervalMinutes", 10), 10) || 10))
    username: root.username
    language: root.language
    courseId: root.courseId
  }

  Component {
    id: tintedBarLogo

    Item {
      implicitWidth: Style.space(18)
      implicitHeight: Style.space(18)

      Image {
        anchors.fill: parent
        source: Qt.resolvedUrl("logo-bar.svg")
        sourceSize.width: Math.round(width * 2)
        sourceSize.height: Math.round(height * 2)
        fillMode: Image.PreserveAspectFit
        smooth: true
        layer.enabled: true
        layer.effect: MultiEffect {
          colorization: 1.0
          colorizationColor: button.active && button.useActiveColor
            ? button.activeColor
            : button.foreground
        }
      }
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.dataReady ? root.formatNumber(root.streakDays) + (root.atRisk ? "!" : "") : "?"
    labelVisible: false
    hasVisualContent: true
    active: root.atRisk
    useActiveColor: true
    fixedWidth: root.vertical
      ? (root.bar ? root.bar.barSize : Style.bar.sizeVertical)
      : Math.max(Style.space(52), horizontalContent.implicitWidth + Style.space(17))
    fixedHeight: root.vertical ? verticalContent.implicitHeight + Style.space(12) : -1
    horizontalMargin: 0
    verticalPadding: 0
    tooltipText: root.barTooltip()

    onPressed: function(buttonCode) {
      if (buttonCode === Qt.MiddleButton) root.refresh(true)
      else root.toggle()
    }

    Row {
      id: horizontalContent
      visible: !root.vertical
      anchors.centerIn: parent
      spacing: Style.space(6)

      Loader {
        anchors.verticalCenter: parent.verticalCenter
        sourceComponent: tintedBarLogo
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: button.text
        textFormat: Text.PlainText
        color: button.active && button.useActiveColor ? button.activeColor : button.foreground
        font.family: button.fontFamily
        font.pixelSize: Style.font.body
        font.bold: root.atRisk
      }
    }

    Column {
      id: verticalContent
      visible: root.vertical
      anchors.centerIn: parent
      spacing: Style.space(3)

      Loader {
        width: Style.space(17)
        height: Style.space(17)
        anchors.horizontalCenter: parent.horizontalCenter
        sourceComponent: tintedBarLogo
      }

      Text {
        width: Math.max(
          Style.space(18),
          (root.bar ? root.bar.barSize : Style.bar.sizeVertical) - Style.space(6))
        anchors.horizontalCenter: parent.horizontalCenter
        text: button.text
        textFormat: Text.PlainText
        color: button.active && button.useActiveColor ? button.activeColor : button.foreground
        font.family: button.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: root.atRisk
        fontSizeMode: Text.HorizontalFit
        minimumPixelSize: Style.space(7)
        horizontalAlignment: Text.AlignHCenter
      }
    }
  }

  KeyboardPanel {
    id: popup
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: root.showingSettings ? usernameField : keyCatcher
    contentWidth: popup.fittedContentWidth(Style.space(400))
    contentHeight: popup.fittedContentHeight(contentColumn.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: {
        if (root.showingSettings) root.closeSettings()
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if (!root.showingSettings && (text === "r" || text === "R")) root.refresh(true)
      }

      Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: contentColumn
          width: parent.width
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: root.showingSettings ? "Duolingo settings" : "Duolingo"
            meta: root.showingSettings
              ? "User configuration"
              : (root.dataReady ? "Public profile" : "Learning stats")
            foreground: root.foreground
            fontFamily: root.fontFamily

            iconComponent: Image {
              width: Style.space(42)
              height: Style.space(42)
              source: Qt.resolvedUrl("logo.svg")
              sourceSize.width: Math.round(width * 2)
              sourceSize.height: Math.round(height * 2)
              fillMode: Image.PreserveAspectFit
              smooth: true
            }

            trailingControl: Component {
              Row {
                width: implicitWidth
                height: implicitHeight
                spacing: Style.space(6)

                PanelActionButton {
                  iconText: "󰑐"
                  tooltipText: "Refresh Duolingo stats"
                  foreground: root.foreground
                  enabled: !stats.loading && !root.showingSettings
                  focusable: true
                  onClicked: root.refresh(true)
                }

                PanelActionButton {
                  iconText: root.showingSettings ? "󰁍" : "󰒓"
                  tooltipText: root.showingSettings ? "Back to stats" : "Settings"
                  foreground: root.foreground
                  focusable: true
                  onClicked: {
                    if (root.showingSettings) root.closeSettings()
                    else root.openSettings()
                  }
                }
              }
            }
          }

          PanelSeparator {
            width: parent.width
            foreground: root.foreground
          }

          Column {
            width: parent.width
            visible: !root.showingSettings && !root.dataReady
            spacing: Style.space(7)

            Text {
              width: parent.width
              text: stats.loading ? "Loading your Duolingo profile..." : "Duolingo data is unavailable"
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              visible: !stats.loading
              text: remoteText(root.snapshot.error) || "Check your Duolingo configuration."
              textFormat: Text.PlainText
              color: root.snapshot.errorCode === "not_configured"
                ? Qt.darker(root.foreground, 1.35)
                : root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              visible: !stats.loading && root.snapshot.errorCode === "not_configured"
              text: "Click the gear icon (󰒓) in the top-right to configure."
              textFormat: Text.PlainText
              color: Qt.darker(root.foreground, 1.5)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Button {
              visible: !stats.loading && (root.snapshot.errorCode === "not_configured" || root.snapshot.errorCode === "invalid_config")
              text: "Configure Settings"
              foreground: root.foreground
              fontFamily: root.fontFamily
              focusable: true
              bordered: true
              onClicked: root.openSettings()
            }
          }

          Column {
            width: parent.width
            visible: !root.showingSettings && root.dataReady
            spacing: Style.space(12)

            Item {
              width: parent.width
              height: Math.max(profileCopy.implicitHeight, streakCopy.implicitHeight)

              Column {
                id: profileCopy
                anchors.left: parent.left
                anchors.right: streakCopy.left
                anchors.rightMargin: Style.space(16)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Text {
                  width: parent.width
                  text: root.snapshot.profile ? remoteText(root.snapshot.profile.name) : ""
                  textFormat: Text.PlainText
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  text: root.snapshot.profile ? "@" + remoteText(root.snapshot.profile.username) : ""
                  textFormat: Text.PlainText
                  color: Qt.darker(root.foreground, 1.45)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }
              }

              Column {
                id: streakCopy
                width: Style.space(126)
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: 0

                Text {
                  width: parent.width
                  text: root.formatNumber(root.streakDays) + (root.atRisk ? "!" : "")
                  textFormat: Text.PlainText
                  color: root.atRisk ? root.urgent : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.display
                  font.bold: true
                  fontSizeMode: Text.HorizontalFit
                  minimumPixelSize: Style.font.title
                  horizontalAlignment: Text.AlignRight
                }

                Text {
                  width: parent.width
                  text: root.dayWord(root.streakDays) + " in your streak"
                  textFormat: Text.PlainText
                  color: root.atRisk ? root.urgent : Qt.darker(root.foreground, 1.45)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: root.atRisk
                  horizontalAlignment: Text.AlignRight
                  elide: Text.ElideLeft
                }
              }
            }

            Rectangle {
              width: parent.width
              height: Math.max(Style.space(40), statusRow.implicitHeight + Style.space(16))
              radius: Style.cornerRadius
              color: {
                var tone = root.todayDone ? root.accent : (root.atRisk ? root.urgent : root.foreground)
                return Qt.rgba(tone.r, tone.g, tone.b, root.atRisk ? 0.14 : 0.09)
              }

              Row {
                id: statusRow
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                spacing: Style.space(9)

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.todayDone ? "✓" : (root.atRisk ? "!" : "-")
                  textFormat: Text.PlainText
                  color: root.todayDone ? root.accent : (root.atRisk ? root.urgent : root.foreground)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                }

                Text {
                  width: Math.max(0, parent.width - parent.children[0].implicitWidth - parent.spacing)
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.statusText()
                  textFormat: Text.PlainText
                  color: root.atRisk ? root.urgent : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.bold: root.atRisk
                  wrapMode: Text.WordWrap
                }
              }
            }

            PanelSeparator {
              width: parent.width
              foreground: root.foreground
            }

            Grid {
              id: metrics
              width: parent.width
              columns: 3
              columnSpacing: Style.space(12)
              rowSpacing: Style.space(10)

              readonly property real cellWidth: Math.max(1, (width - columnSpacing * 2) / 3)

              Metric {
                width: metrics.cellWidth
                label: "Course XP"
                value: root.formatNumber(root.snapshot.courseXp)
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Metric {
                width: metrics.cellWidth
                label: "Total XP"
                value: root.formatNumber(root.snapshot.totalXp)
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Metric {
                width: metrics.cellWidth
                label: "League"
                value: root.snapshot.leaderboard
                  ? remoteText(root.snapshot.leaderboard.league)
                  : "Unranked"
                foreground: root.foreground
                fontFamily: root.fontFamily
              }
            }

            Text {
              width: parent.width
              visible: root.snapshot.stale === true
              text: "Showing cached data. "
                + (remoteText(root.snapshot.error) || "Duolingo is temporarily unavailable.")
              textFormat: Text.PlainText
              color: root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              visible: root.updatedLabel() !== ""
              text: root.updatedLabel()
              textFormat: Text.PlainText
              color: Qt.darker(root.foreground, 1.55)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              horizontalAlignment: Text.AlignRight
            }
          }

          Column {
            width: parent.width
            visible: root.showingSettings
            spacing: Style.space(10)

            PanelSectionHeader {
              width: parent.width
              text: "Duolingo username"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            TextField {
              id: usernameField
              width: parent.width
              maximumLength: 64
              placeholderText: "Duolingo username"
              foreground: root.foreground
              accent: root.accent
            }

            PanelSectionHeader {
              width: parent.width
              text: "Language code"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            TextField {
              id: languageField
              width: parent.width
              maximumLength: 32
              placeholderText: "e.g. es, de, ja (optional)"
              foreground: root.foreground
              accent: root.accent
            }

            PanelSectionHeader {
              width: parent.width
              text: "Course ID"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            TextField {
              id: courseIdField
              width: parent.width
              maximumLength: 128
              placeholderText: "Exact course ID (optional)"
              foreground: root.foreground
              accent: root.accent
            }

            Item {
              width: parent.width
              height: Math.max(cancelButton.implicitHeight, saveButton.implicitHeight)

              Button {
                id: cancelButton
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: "Cancel"
                foreground: root.foreground
                focusable: true
                onClicked: root.closeSettings()
              }

              Button {
                id: saveButton
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                bordered: true
                iconText: "󰆓"
                text: "Save"
                foreground: root.foreground
                focusable: true
                onClicked: root.saveSettings()
              }
            }
          }
        }
      }
    }
  }
}
