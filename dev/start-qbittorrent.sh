#!/bin/sh

# Starts a real qbittorrent-nox (static build from userdocs/qbittorrent-nox-static)
# that serves this repository as its alternative WebUI on http://127.0.0.1:8080.
# Clients on localhost don't need to log in. Everything is kept in dev/.cache.
#
# Environment variables:
#   QBT_RELEASE  release tag of userdocs/qbittorrent-nox-static (default below)
#   QBT_PORT     WebUI port (default 8080)

set -eu

DEV_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(dirname "$DEV_DIR")
CACHE_DIR="$DEV_DIR/.cache"
QBT_RELEASE="${QBT_RELEASE:-release-5.2.4_v2.0.15}"
QBT_PORT="${QBT_PORT:-8080}"

BINARY="$CACHE_DIR/qbittorrent-nox-$QBT_RELEASE"
mkdir -p "$CACHE_DIR"
if [ ! -x "$BINARY" ]; then
    echo "Downloading qbittorrent-nox ($QBT_RELEASE, $(uname -m))..."
    curl -fL -o "$BINARY.part" \
        "https://github.com/userdocs/qbittorrent-nox-static/releases/download/$QBT_RELEASE/$(uname -m)-qbittorrent-nox"
    chmod +x "$BINARY.part"
    mv "$BINARY.part" "$BINARY"
fi

PROFILE_DIR="$CACHE_DIR/profile"
CONFIG_FILE="$PROFILE_DIR/qBittorrent/config/qBittorrent.conf"
if [ ! -f "$CONFIG_FILE" ]; then
    mkdir -p "$(dirname "$CONFIG_FILE")" "$CACHE_DIR/downloads"
    cat > "$CONFIG_FILE" <<CONFIG
[LegalNotice]
Accepted=true

[BitTorrent]
Session\\DefaultSavePath=$CACHE_DIR/downloads
Session\\Port=56881
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
