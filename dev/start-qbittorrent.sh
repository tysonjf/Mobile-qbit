#!/bin/sh

# Starts a real qbittorrent-nox (static build from userdocs/qbittorrent-nox-static)
# that serves this repository as its alternative WebUI on http://127.0.0.1:8080.
# Clients on localhost don't need to log in. Everything is kept in dev/.cache.
#
# Environment variables:
#   QBT_RELEASE  release tag of userdocs/qbittorrent-nox-static (default below)
#   QBT_PORT     WebUI port (default 8080)
#   QBT_PROFILE  profile folder in dev/.cache (default "profile"). Another one starts
#                a second qbittorrent-nox, e.g. the peer for the Peers tab:
#                QBT_PROFILE=peer QBT_PORT=8081 QBT_BT_PORT=56882 sh start-qbittorrent.sh
#   QBT_BT_PORT  BitTorrent port (default 56881)

set -eu

DEV_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(dirname "$DEV_DIR")
CACHE_DIR="$DEV_DIR/.cache"
QBT_RELEASE="${QBT_RELEASE:-release-5.2.4_v2.0.15}"
QBT_PORT="${QBT_PORT:-8080}"
QBT_PROFILE="${QBT_PROFILE:-profile}"
QBT_BT_PORT="${QBT_BT_PORT:-56881}"

BINARY="$CACHE_DIR/qbittorrent-nox-$QBT_RELEASE"
mkdir -p "$CACHE_DIR"
if [ ! -x "$BINARY" ]; then
    echo "Downloading qbittorrent-nox ($QBT_RELEASE, $(uname -m))..."
    curl -fL -o "$BINARY.part" \
        "https://github.com/userdocs/qbittorrent-nox-static/releases/download/$QBT_RELEASE/$(uname -m)-qbittorrent-nox"
    chmod +x "$BINARY.part"
    mv "$BINARY.part" "$BINARY"
fi

PROFILE_DIR="$CACHE_DIR/$QBT_PROFILE"
DOWNLOADS_DIR="$CACHE_DIR/downloads"
if [ "$QBT_PROFILE" != "profile" ]; then
    DOWNLOADS_DIR="$PROFILE_DIR/downloads"
fi
CONFIG_FILE="$PROFILE_DIR/qBittorrent/config/qBittorrent.conf"
if [ ! -f "$CONFIG_FILE" ]; then
    mkdir -p "$(dirname "$CONFIG_FILE")" "$DOWNLOADS_DIR"
    cat > "$CONFIG_FILE" <<CONFIG
[LegalNotice]
Accepted=true

[BitTorrent]
Session\\DefaultSavePath=$DOWNLOADS_DIR
Session\\Port=$QBT_BT_PORT
Session\\QueueingSystemEnabled=true

[Preferences]
General\\Locale=en
WebUI\\AlternativeUIEnabled=true
WebUI\\CSRFProtection=false
WebUI\\HostHeaderValidation=false
WebUI\\LocalHostAuth=false
WebUI\\Port=$QBT_PORT
WebUI\\RootFolder=$REPO_DIR
CONFIG
fi

echo "Serving $REPO_DIR on http://127.0.0.1:$QBT_PORT"
exec "$BINARY" --profile="$PROFILE_DIR"
