pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Effects
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
    ? String(snapshot.course.title)
    : "your course"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function formatNumber(value) {
    if (value === undefined || value === null || value === "") return "-"
    var number = Number(value)
    if (!isFinite(number)) return "-"
    return String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
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
      return snapshot.error
        ? String(snapshot.error)
        : "Configure your Duolingo profile to show your streak."
    }
    if (atRisk) {
      return "Complete a " + languageName + " lesson today to protect your "
        + formatNumber(streakDays) + "-" + dayWord(streakDays) + " streak!"
    }
    if (streakDays === 0) {
      return "Complete a " + languageName + " lesson today to begin a Duolingo streak."
    }
    return "Your current Duolingo streak while learning " + languageName + " is "
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
    refreshIntervalMinutes: Math.max(1, parseInt(root.setting("refreshIntervalMinutes", 10), 10) || 10)
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
    focusTarget: keyCatcher
    contentWidth: popup.fittedContentWidth(Style.space(400))
    contentHeight: popup.fittedContentHeight(contentColumn.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if (text === "r" || text === "R") root.refresh(true)
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
            title: "Duolingo"
            meta: root.dataReady
              ? root.languageName + " public profile"
              : "Learning stats"
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
              PanelActionButton {
                iconText: "󰑐"
                tooltipText: "Refresh Duolingo stats"
                foreground: root.foreground
                fontFamily: root.fontFamily
                enabled: !stats.loading
                focusable: true
                onClicked: root.refresh(true)
              }
            }
          }

          PanelSeparator {
            width: parent.width
            foreground: root.foreground
          }

          Column {
            width: parent.width
            visible: !root.dataReady
            spacing: Style.space(7)

            Text {
              width: parent.width
              text: stats.loading ? "Loading your Duolingo profile..." : "Duolingo data is unavailable"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              visible: !stats.loading
              text: root.snapshot.error || "Check your Duolingo configuration."
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
              text: stats.configPath
              color: Qt.darker(root.foreground, 1.5)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideMiddle
            }
          }

          Column {
            width: parent.width
            visible: root.dataReady
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
                  text: root.snapshot.profile ? root.snapshot.profile.name : ""
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  text: root.snapshot.profile ? "@" + root.snapshot.profile.username : ""
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
                  color: root.todayDone ? root.accent : (root.atRisk ? root.urgent : root.foreground)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                }

                Text {
                  width: Math.max(0, parent.width - parent.children[0].implicitWidth - parent.spacing)
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.statusText()
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
                  ? root.snapshot.leaderboard.league
                  : "Unranked"
                foreground: root.foreground
                fontFamily: root.fontFamily
              }
            }

            Text {
              width: parent.width
              visible: root.snapshot.stale === true
              text: "Showing cached data. "
                + (root.snapshot.error || "Duolingo is temporarily unavailable.")
              color: root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Text {
              width: parent.width
              visible: root.updatedLabel() !== ""
              text: root.updatedLabel()
              color: Qt.darker(root.foreground, 1.55)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              horizontalAlignment: Text.AlignRight
            }
          }
        }
      }
    }
  }
}
