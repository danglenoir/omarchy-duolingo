import QtQuick
import qs.Commons

Item {
  id: root

  property string label: ""
  property string value: "-"
  property color foreground: Color.foreground
  property color valueColor: foreground
  property string fontFamily: Style.font.family

  implicitHeight: Style.space(48)

  Text {
    id: valueText
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    height: Style.space(25)
    text: root.value
    textFormat: Text.PlainText
    color: root.valueColor
    font.family: root.fontFamily
    font.pixelSize: Style.font.title
    font.bold: true
    fontSizeMode: Text.HorizontalFit
    minimumPixelSize: Style.font.caption
    elide: Text.ElideRight
    verticalAlignment: Text.AlignVCenter
  }

  Text {
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: valueText.bottom
    text: root.label
    textFormat: Text.PlainText
    color: Qt.darker(root.foreground, 1.45)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    elide: Text.ElideRight
  }
}
