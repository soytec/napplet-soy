#!/usr/bin/env bash
set -Eeuo pipefail

# Debian/Ubuntu VPS; dedicated or explicitly shared stock Caddy service. All app state is scoped to this installation.
release_id=${1:?release id required}
domain=${2:?domain required}
blossom_domain=${3:-blossom.$domain}
git_domain=${4:-git.$domain}
proxy_mode=${5:-dedicated}
web_port=${6:-3000}
admin_pubkey=${7:?admin public key required}
runtime_profile=${8:-standard}
relay_domain=${9:-relay.$domain}
[[ "$runtime_profile" == standard || "$runtime_profile" == legacy-x64 ]] || exit 2
[[ "$proxy_mode" == dedicated || "$proxy_mode" == shared ]] || exit 2
[[ "$web_port" =~ ^[0-9]{4,5}$ && "$web_port" -ge 1024 && "$web_port" -le 65534 ]] || exit 2
[[ "$admin_pubkey" =~ ^[a-f0-9]{64}$ ]] || exit 2
smoke_port=$((web_port+1))
[[ "$web_port" -lt 19346 || "$web_port" -gt 19352 ]] || exit 2
[[ "$web_port" != 3477 && "$web_port" != 3478 ]] || exit 2
[[ "$release_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}$ ]] || exit 2
[[ "$blossom_domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}$ && "$blossom_domain" != "$domain" ]] || exit 2
[[ "$git_domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}$ && "$git_domain" != "$domain" && "$git_domain" != "$blossom_domain" ]] || exit 2
[[ "$relay_domain" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}$ && "$relay_domain" != "$domain" && "$relay_domain" != "www.$domain" && "$relay_domain" != "$blossom_domain" && "$relay_domain" != "$git_domain" ]] || exit 2
[[ $EUID -eq 0 ]] || { echo 'Root or passwordless sudo is required.' >&2; exit 1; }
# deploy.ts sends the shared helper before this script over stdin. Also support
# direct invocation from a checkout; enforce the same guard before any writes.
if ! declare -F napplet_check_cpu >/dev/null; then
  source "$(dirname "${BASH_SOURCE[0]}")/deploy-cpu-check.sh"
fi
napplet_check_cpu "$(uname -s)" "$(uname -m)" /proc/cpuinfo "$runtime_profile"
command -v apt-get >/dev/null || { echo 'This script supports Debian/Ubuntu VPS hosts.' >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo 'A running systemd host is required.' >&2; exit 1; }
exec 9>/var/lock/napplet-space-deploy.lock
flock -n 9 || { echo 'Another napplet deployment is running.' >&2; exit 1; }

app_root=/opt/napplet-space
state_root=/var/lib/napplet-space
release_dir="$app_root/releases/$release_id"
archive="/tmp/napplet-$release_id.tar.gz"
# Inspect before package installation, preserving existing listeners and proxy ownership.
command -v ss >/dev/null || { echo 'Preflight needs ss (iproute2); no changes made.' >&2; exit 1; }
if [[ "$proxy_mode" == shared ]]; then
  [[ -x /usr/bin/caddy && -f /etc/caddy/Caddyfile && ! -L /etc/caddy/Caddyfile ]] || { echo 'Shared mode requires the stock Caddyfile installation.' >&2; exit 1; }
  systemctl is-active --quiet caddy
  systemctl show caddy -p ExecStart --value | grep -Fq '/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile'
  [[ -z "$(systemctl show caddy -p DropInPaths --value)" ]] || { echo 'Inspect custom Caddy unit overrides before using shared mode.' >&2; exit 1; }
  # Inspect the host configuration without our owned fragment, also on upgrades
  # which add a hostname. Never take a hostname from another site's block.
  host_check="/etc/caddy/.napplet-host-preflight-$$"
  sed '\|^import /etc/napplet-space/Caddyfile$|d' /etc/caddy/Caddyfile > "$host_check"
  chmod 644 "$host_check"
  if ! /usr/bin/caddy adapt --config "$host_check" --adapter caddyfile 2>/dev/null | python3 -c '
import json,sys
names=set(sys.argv[1:]); found=set()
def walk(x):
 if isinstance(x,dict):
  for k,v in x.items():
   if k=="host" and isinstance(v,list): found.update(names.intersection(v))
   walk(v)
 elif isinstance(x,list):
  for v in x: walk(v)
walk(json.load(sys.stdin))
if found: sys.exit("A requested hostname already belongs to the existing Caddy configuration.")
' "$domain" "www.$domain" "$blossom_domain" "$git_domain" "$relay_domain"; then
    rm -f "$host_check"
    exit 1
  fi
  rm -f "$host_check"
elif [[ -n "$(ss -H -ltn '( sport = :80 or sport = :443 )')" ]]; then
  if ! systemctl is-active --quiet napplet-space-caddy || [[ ! -f /etc/napplet-space/Caddyfile ]] || ! grep -Fxq "$domain {" /etc/napplet-space/Caddyfile; then
    echo 'An existing site owns HTTP/HTTPS. Run --preflight and use an inspected shared proxy; no changes made.' >&2; exit 1
  fi
fi
if [[ -f "$app_root/shared/deploy-profile" && "$(cat "$app_root/shared/deploy-profile")" != "$proxy_mode:$web_port" ]]; then
  echo 'Changing existing proxy mode or application ports needs an explicit migration.' >&2; exit 1
fi
if [[ -n "$(ss -H -ltn "sport = :$smoke_port")" ]]; then echo 'Candidate port is occupied.' >&2; exit 1; fi
if [[ ! -L "$app_root/current" ]] && [[ -n "$(ss -H -ltn "( sport = :$web_port or sport = :19347 or sport = :19348 or sport = :19349 or sport = :19351 )")" ]]; then
  echo 'A required application port is occupied; no changes made.' >&2; exit 1
fi
bun_version=1.3.11
[[ "$runtime_profile" != legacy-x64 ]] || bun_version=1.3.8
bun_bin="$app_root/tools/bun$bun_version/bin/bun"
caddy_version=2.10.2
pm2_version=7.0.4
go_version=1.25.0
rust_version=1.97.1
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
packages=(ca-certificates curl unzip tar xz-utils build-essential git pkg-config libssl-dev)
if [[ "$runtime_profile" == legacy-x64 ]]; then
  packages+=(meson ninja-build libglib2.0-dev libexpat1-dev libjpeg-dev libpng-dev libwebp-dev libexif-dev liblcms2-dev)
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then packages+=(nodejs npm); fi
missing=()
for package in "${packages[@]}"; do
  [[ "$(dpkg-query -W -f '${Status}' "$package" 2>/dev/null || true)" == 'install ok installed' ]] || missing+=("$package")
done
if [[ ${#missing[@]} -gt 0 ]]; then apt-get update -qq; apt-get install -y -qq --no-upgrade "${missing[@]}"; fi
id napplet >/dev/null 2>&1 || useradd --system --create-home --home-dir "$state_root" --shell /usr/sbin/nologin napplet
install -d -m 755 "$app_root/bin" "$app_root/tools" "$app_root/releases" "$app_root/shared" /etc/napplet-space
install -d -o napplet -g napplet -m 750 "$state_root/pm2" "$state_root/caddy" "$state_root/relay" "$state_root/blossom" "$state_root/grasp" "$state_root/index" "$state_root/moderation" "$state_root/community"
if [[ "$runtime_profile" == legacy-x64 ]]; then
  install -d -o napplet -g napplet -m 755 "$app_root/tools/legacy-images"
fi

case "$(uname -m)" in
  x86_64) rust_target=x86_64-unknown-linux-gnu; rust_sha=88f28fa9af20594179f85d6df67078dfd6fa93e2f6da5e1e9b0ac4997988ca4f; bun_asset=bun-linux-x64-baseline.zip; caddy_arch=amd64; go_sha=2852af0cb20a13139b3448992e69b868e50ed0f8a1e5940ee1de9e19a123b613 ;;
  aarch64|arm64) rust_target=aarch64-unknown-linux-gnu; rust_sha=9a7a2c336b4787f1b72f6bab7c35d5b7af2fd03cbd39b4fc721466a70d402a7d; bun_asset=bun-linux-aarch64.zip; caddy_arch=arm64; go_sha=05de75d6994a2783699815ee553bd5a9327d8b79991de36e38b66862782f54ae ;;
  *) echo 'Supported VPS architectures: x86_64 and arm64.' >&2; exit 1 ;;
esac
tool_staging=$(mktemp -d)
trap 'rm -rf "$tool_staging"' EXIT
if [[ ! -x "$bun_bin" ]] || [[ "$("$bun_bin" --version)" != "$bun_version" ]]; then
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/$bun_asset" -o "$tool_staging/$bun_asset"
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/SHASUMS256.txt" -o "$tool_staging/bun-checksums"
  (cd "$tool_staging"; awk -v asset="$bun_asset" '$2 == asset {print}' bun-checksums > bun-selected; test -s bun-selected; sha256sum -c bun-selected; unzip -q "$bun_asset")
  install -d -m 755 "$(dirname "$bun_bin")"
  install -m 755 "$tool_staging/${bun_asset%.zip}/bun" "$bun_bin"
fi
# --version does not initialize JavaScriptCore. Exercise real JavaScript before
# installing further toolchains or starting a costly build on a shared host.
systemd-run --quiet --wait --pipe --collect --unit="napplet-runtime-$release_id" -p MemoryMax=768M -p MemorySwapMax=0 -p CPUQuota=100% -p RuntimeMaxSec=15s -p TimeoutStopSec=2s -p LimitCORE=0 -p User=napplet -p WorkingDirectory="$state_root" -- "$bun_bin" -e 'console.log("Bun runtime ready:", Bun.version)'
caddy_asset="caddy_${caddy_version}_linux_${caddy_arch}.tar.gz"
if [[ "$proxy_mode" == dedicated ]] && { [[ ! -x "$app_root/bin/caddy" ]] || [[ "$("$app_root/bin/caddy" version)" != "v$caddy_version "* ]]; }; then
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/$caddy_asset" -o "$tool_staging/$caddy_asset"
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/caddy_${caddy_version}_checksums.txt" -o "$tool_staging/caddy-checksums"
  (cd "$tool_staging"; awk -v asset="$caddy_asset" '$2 == asset {print}' caddy-checksums > caddy-selected; test -s caddy-selected; sha512sum -c caddy-selected; tar -xzf "$caddy_asset" caddy)
  install -m 755 "$tool_staging/caddy" "$app_root/bin/caddy"
fi
# Native LMDB uses cgo. Keep the same verified toolchain as local builds.
go_root="$app_root/tools/go$go_version"
if [[ ! -x "$go_root/go/bin/go" ]] || [[ "$("$go_root/go/bin/go" version)" != "go version go$go_version "* ]]; then
  go_asset="go$go_version.linux-$caddy_arch.tar.gz"
  curl -fsSL "https://go.dev/dl/$go_asset" -o "$tool_staging/$go_asset"
  (cd "$tool_staging"; printf '%s  %s\n' "$go_sha" "$go_asset" | sha256sum -c -)
  install -d "$go_root"
  tar -xzf "$tool_staging/$go_asset" -C "$go_root"
fi
# Standalone pinned Rust distribution; do not replace the host's Rust installation.
rust_root="$app_root/tools/rust$rust_version"
if [[ ! -x "$rust_root/bin/rustc" ]] || [[ "$("$rust_root/bin/rustc" --version)" != "rustc $rust_version "* ]]; then
  rust_asset="rust-$rust_version-$rust_target.tar.xz"
  curl -fsSL "https://static.rust-lang.org/dist/$rust_asset" -o "$tool_staging/$rust_asset"
  (cd "$tool_staging"; printf '%s  %s\n' "$rust_sha" "$rust_asset" | sha256sum -c -; tar -xJf "$rust_asset")
  "$tool_staging/${rust_asset%.tar.xz}/install.sh" --prefix="$rust_root" --components="rustc,cargo,rust-std-$rust_target" --disable-ldconfig
fi
if [[ ! -f "$app_root/tools/node_modules/pm2/package.json" ]] || [[ "$(node -p "require('$app_root/tools/node_modules/pm2/package.json').version")" != "$pm2_version" ]]; then
  npm install --prefix "$app_root/tools" --no-audit --no-fund "pm2@$pm2_version"
fi
pm2_bin="$app_root/tools/node_modules/pm2/bin/pm2"
pm2_run() { runuser -u napplet -- env PM2_HOME="$state_root/pm2" PATH="$app_root/bin:/usr/sbin:/usr/bin:/sbin:/bin" node "$pm2_bin" "$@"; }

[[ ! -e "$release_dir" ]] || { echo 'Release directory already exists.' >&2; exit 1; }
install -d -o napplet -g napplet "$release_dir"
tar -xzf "$archive" -C "$release_dir" --no-same-owner
rm "$archive"
chown -R napplet:napplet "$release_dir"
# SSH can start in /root, which the service user cannot traverse. Bun 1.3.8
# exposes an empty process.env from that directory, losing ports and policy.
# Use the service-owned release for every following application command.
cd "$release_dir"
# A release retains its runtime when switching profiles or rolling back.
install -d -o napplet -g napplet -m 755 "$release_dir/bin"
ln -s "$bun_bin" "$release_dir/bin/bun"
printf '%s\n' "$runtime_profile" > "$release_dir/runtime-profile"
release_bun() {
  if [[ -x "$1/bin/bun" ]]; then printf '%s\n' "$1/bin/bun"; else printf '%s\n' "$app_root/bin/bun"; fi
}
# Runtime secrets belong in shared/server.env, outside the uploaded repository.
# VITE_* values are public build configuration and must never contain credentials.
if [[ -f "$app_root/shared/server.env" ]]; then
  set -a
  source "$app_root/shared/server.env"
  set +a
fi
export PATH="$release_dir/bin:$rust_root/bin:$go_root/go/bin:$app_root/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export SPACE_SITE_ORIGIN="https://$domain"
export SPACE_BLOSSOM_ORIGIN="https://$blossom_domain"
export SPACE_CLI_DOWNLOAD_DIR="${SPACE_CLI_DOWNLOAD_DIR:-$app_root/downloads/cli}"
export PORT="$web_port"
export SPACE_ADMIN_PUBKEYS="${SPACE_ADMIN_PUBKEYS:-$admin_pubkey}"
export SPACE_MODERATION_FILE="$state_root/moderation/policy.json"
export VITE_NOSTR_RELAYS="${VITE_NOSTR_RELAYS:-wss://$relay_domain}"
# Store only public deployment identity; operator secrets stay in server.env.
printf '%s\n' "$SPACE_ADMIN_PUBKEYS" > "$app_root/shared/admin-pubkeys"
chmod 600 "$app_root/shared/admin-pubkeys"
export SPACE_PUBLICDEV=0 SPACE_PUBLICDEV_DIR=''
export SPACE_INDEX_DIR="$state_root/index"
export SPACE_COMMUNITY_DIR="$state_root/community"
source "$release_dir/scripts/index-env.sh"
napplet_index_env "$domain" "$release_dir/packages/nostr/discovery-relays.json" "$relay_domain"
printf '%s\n' "https://$relay_domain" > "$release_dir/relay-origin"
printf '%s\n' "https://$domain/relay" > "$release_dir/relay-aliases"
printf '%s\n' "$SPACE_INDEX_HINTS" > "$release_dir/index-hints"
export SPACE_INDEX_LOCAL_BLOSSOM=''
# GRASP migrations are not reversible by switching binaries. Pin changes need a
# separately rehearsed migration/restore procedure; ordinary deploys cannot do it.
grasp_commit=$(node -p "require(process.argv[1]).commit" "$release_dir/services/grasp/upstream.json")
if [[ -f "$state_root/grasp/upstream.commit" ]] && [[ "$(cat "$state_root/grasp/upstream.commit")" != "$grasp_commit" ]]; then
  echo 'GRASP upstream pin changed. Stop here: migrate/restore its full state separately before deployment.' >&2
  exit 1
fi
systemd-run --scope --quiet --unit="napplet-build-$release_id" -p MemoryMax=3G -p CPUQuota=200% -p TasksMax=512 runuser -u napplet -- env -u SPACE_MODERATION_FILE -u SPACE_ADMIN_PUBKEYS -u SPACE_DYNAMIC_CREATORS -u SPACE_DYNAMIC_ENABLED -u SPACE_DYNAMIC_SOURCE_ORIGINS -u SPACE_DYNAMIC_BUNDLE_DIR -u SPACE_INDEX_DIR -u SPACE_COMMUNITY_DIR GOMAXPROCS=2 GOFLAGS=-p=2 CARGO_BUILD_JOBS=2 nice -n 10 bash -ec 'cd "$1"; "$2" install --frozen-lockfile; if [[ "$3" == legacy-x64 ]]; then bash scripts/legacy-images.sh "$1" "$4"; fi; "$2" run check; "$2" run test:relay; "$2" run test:blossom; "$2" run test:grasp; "$2" scripts/relay.ts build "$1/bin/napplet-relay"; "$2" scripts/blossom.ts build "$1/bin/blossom.js"; "$2" scripts/grasp-build.ts "$1/bin/ngit-grasp"; "$2" run build' -- "$release_dir" "$bun_bin" "$runtime_profile" "$app_root/tools/legacy-images"

runuser -u napplet -- "$bun_bin" "$release_dir/scripts/moderation-init.ts" "$SPACE_MODERATION_FILE"

# Durable CVM identity/boards are independent of release directories.
install -d -o napplet -g napplet -m 700 "$state_root/cvm"
export SPACE_CVM_KEY_PATH="$state_root/cvm/identity"
export SPACE_CVM_DATA_PATH="$state_root/cvm/boards.sqlite"
export SPACE_CVM_RELAYS='ws://127.0.0.1:19351'
export SPACE_RELAY_CVM_BIND='127.0.0.1:19351'
export SPACE_CVM_PUBLIC_RELAYS="wss://$relay_domain"
export SPACE_CVM_ANNOUNCE=1
if [[ "${SPACE_DYNAMIC_ENABLED:-0}" == 1 ]]; then
  [[ -n "${SPACE_DYNAMIC_CREATORS:-}" && -n "${SPACE_DYNAMIC_SOURCE_ORIGINS:-}" ]] || { echo 'Dynamic backends need explicit creator pubkeys and source origins in shared/server.env.' >&2; exit 1; }
  bash "$release_dir/scripts/backend-sandbox-install.sh"
  runuser -u napplet -- "$bun_bin" "$release_dir/scripts/backend-workers.ts" "$release_dir/bin/backend-workers"
  # A release-local marker also makes rollback choose the correct process manager.
  touch "$release_dir/dynamic-backends-enabled"
  export SPACE_DYNAMIC_BUNDLE_DIR="$release_dir/bin/backend-workers"
  systemd-run --quiet --wait --pipe --collect --unit="napplet-backend-preflight-$release_id" -p User=napplet -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=128 -p CPUQuota=200% -p Delegate=yes -p DelegateSubgroup=supervisor -p OOMPolicy=continue -p RuntimeMaxSec=30s -p NoNewPrivileges=yes -p PrivateTmp=yes -p ProtectHome=yes -p ProtectSystem=strict -p "ReadWritePaths=/sys/fs/cgroup/system.slice/napplet-backend-preflight-$release_id.service" -- "$bun_bin" "$release_dir/scripts/backend-preflight.ts" "$SPACE_DYNAMIC_BUNDLE_DIR"
  systemd-run --quiet --wait --pipe --collect --unit="napplet-backend-check-$release_id" -p User=napplet -p WorkingDirectory="$release_dir" -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=128 -p CPUQuota=200% -p Delegate=yes -p DelegateSubgroup=supervisor -p OOMPolicy=continue -p RuntimeMaxSec=120s -p NoNewPrivileges=yes -p PrivateTmp=yes -p ProtectHome=yes -p ProtectSystem=strict -p "ReadWritePaths=/sys/fs/cgroup/system.slice/napplet-backend-check-$release_id.service" -E SPACE_TEST_BACKEND_SANDBOX=1 -E SPACE_DYNAMIC_BUNDLE_DIR="$SPACE_DYNAMIC_BUNDLE_DIR" -- "$bun_bin" test tests/services/dynamic-backend-linux.test.ts
fi
SPACE_CVM_PUBKEY=$(runuser -u napplet -- env SPACE_CVM_KEY_PATH="$SPACE_CVM_KEY_PATH" "$bun_bin" "$release_dir/apps/cvm/src/index.ts" --identity)
export SPACE_CVM_PUBKEY
if [[ "${SPACE_MANAGED_TURN:-1}" == 1 ]]; then
  bash "$release_dir/scripts/turn-setup.sh" "$domain" "$state_root"
  export SPACE_TURN_SECRET_PATH="$state_root/cvm/turn-secret"
  export SPACE_TURN_URLS="turn:$domain:3478?transport=udp,turn:$domain:3478?transport=tcp"
fi

start_relay() {
  local source_release=$1
  local origin="https://$domain/relay" aliases=''
  [[ ! -f "$source_release/relay-origin" ]] || origin=$(cat "$source_release/relay-origin")
  [[ ! -f "$source_release/relay-aliases" ]] || aliases=$(cat "$source_release/relay-aliases")
  runuser -u napplet -- env PM2_HOME="$state_root/pm2" SPACE_RELEASE_DIR="$source_release" SPACE_SERVICE_PREFIX=napplet SPACE_RELAY_BIND=127.0.0.1:19347 SPACE_RELAY_BIN="$source_release/bin/napplet-relay" SPACE_RELAY_DATA="$state_root/relay" SPACE_RELAY_ORIGIN="$origin" SPACE_RELAY_ALIASES="$aliases" SPACE_RELAY_INSTANCE="$domain" PATH="$source_release/bin:$PATH" node "$pm2_bin" start "$source_release/infra/relay.ecosystem.config.cjs" --update-env
}
relay_ready() {
  local expected
  expected=$(cat "$1/bin/napplet-relay.build")
  for attempt in {1..60}; do
    if curl -fsS --max-time 2 http://127.0.0.1:19347/health 2>/dev/null | grep -Fq "\"build\":\"$expected\""; then return 0; fi
    sleep 1
  done
  return 1
}
start_blossom() {
  local source_release=$1
  runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$(release_bun "$source_release")" SPACE_RELEASE_DIR="$source_release" SPACE_SERVICE_PREFIX=napplet SPACE_BLOSSOM_PORT=19348 SPACE_BLOSSOM_BUNDLE="$source_release/bin/blossom.js" SPACE_BLOSSOM_DATA="$state_root/blossom" SPACE_BLOSSOM_ORIGIN="https://$blossom_domain" SPACE_BLOSSOM_LOCAL=0 SPACE_BLOSSOM_INSTANCE="$domain" PATH="$source_release/bin:$PATH" node "$pm2_bin" start "$source_release/infra/blossom.ecosystem.config.cjs" --update-env
}
blossom_ready() {
  local expected response
  expected=$(cat "$1/bin/blossom.js.build")
  for attempt in {1..30}; do
    response=$(curl -fsS --max-time 2 http://127.0.0.1:19348/health 2>/dev/null) || response=''
    if [[ "$response" == *"\"build\":\"$expected\""* && "$response" == *"\"instance\":\"$domain\""* ]]; then return 0; fi
    sleep 1
  done
  return 1
}

start_grasp() {
  local source_release=$1
  runuser -u napplet -- env PM2_HOME="$state_root/pm2" SPACE_RELEASE_DIR="$source_release" SPACE_SERVICE_PREFIX=napplet SPACE_GRASP_BIN="$source_release/bin/ngit-grasp" SPACE_GRASP_DATA="$state_root/grasp" SPACE_GRASP_ORIGIN="https://$git_domain" SPACE_GRASP_LOCAL=0 SPACE_GRASP_INSTANCE="$domain" PATH="$source_release/bin:$PATH" node "$pm2_bin" start "$source_release/infra/grasp.ecosystem.config.cjs" --update-env
}
start_indexer() {
  local source_release=$1
  local hints="${SPACE_INDEX_HINTS//wss:\/\/$relay_domain/wss:\/\/$domain\/relay}"
  [[ ! -f "$source_release/index-hints" ]] || hints=$(cat "$source_release/index-hints")
  runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$(release_bun "$source_release")" SPACE_INDEX_HINTS="$hints" SPACE_RELEASE_DIR="$source_release" SPACE_RELEASE_ID="$(basename "$source_release")" SPACE_SERVICE_PREFIX=napplet PATH="$source_release/bin:$PATH" node "$pm2_bin" start "$source_release/infra/indexer.ecosystem.config.cjs" --update-env
}
stop_cvm() {
  if [[ -f /etc/systemd/system/napplet-cvm.service ]]; then systemctl disable --now napplet-cvm.service; fi
  pm2_run delete napplet-cvm || true
}
start_cvm() {
  local source_release=$1 dynamic=0
  if [[ -f "$source_release/dynamic-backends-enabled" ]]; then
    dynamic=1
    bash "$source_release/scripts/backend-service.sh" "$source_release" "$(release_bun "$source_release")"
  else
    runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$(release_bun "$source_release")" SPACE_RELEASE_DIR="$source_release" SPACE_DYNAMIC_ENABLED=0 PATH="$source_release/bin:$PATH" node "$pm2_bin" start "$source_release/infra/cvm.ecosystem.config.cjs" --update-env
  fi
  runuser -u napplet -- env SPACE_DYNAMIC_ENABLED="$dynamic" "$(release_bun "$source_release")" "$source_release/scripts/cvm-health.ts"
}
indexer_ready() {
  local source_release=$1
  for attempt in {1..60}; do
    if runuser -u napplet -- env SPACE_RELEASE_ID="$(basename "$source_release")" "$(release_bun "$source_release")" "$source_release/scripts/index-health.ts"; then return 0; fi
    sleep 1
  done
  return 1
}
grasp_ready() {
  local expected response
  expected=$(cd "$1"; "$(release_bun "$1")" -e 'import { graspVersion } from "./scripts/grasp-build"; console.log(await graspVersion())')
  for attempt in {1..60}; do
    response=$(curl -fsS --max-time 2 -H 'Accept: application/nostr+json' http://127.0.0.1:19349/ 2>/dev/null) || response=''
    if "$bun_bin" "$release_dir/scripts/deploy-state.ts" grasp "$expected" "Napplet Space Git ($domain)" <<< "$response"; then return 0; fi
    sleep 1
  done
  return 1
}

previous=$("$bun_bin" "$release_dir/scripts/deploy-state.ts" previous "$app_root/current")
studio_configured=0
[[ ! -f /etc/napplet-space/studio.json ]] || studio_configured=1
start_studio() {
  local source_release=$1
  [[ "$studio_configured" == 1 ]] || return 0
  if [[ ! -f "$source_release/apps/studio/hosting/main.ts" ]]; then
    systemctl stop napplet-studio.service
    return 0
  fi
  install -o root -g root -m 644 "$source_release/infra/studio.service" /etc/systemd/system/napplet-studio.service
  install -o root -g root -m 755 "$source_release/scripts/studio-egress.sh" /usr/local/libexec/napplet-studio-egress
  systemctl daemon-reload
  systemctl restart napplet-studio.service
  for attempt in {1..30}; do
    if curl -fsS --max-time 2 http://127.0.0.1:19352/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'Hosted Studio did not become healthy; rolling back the website.' >&2
  return 1
}
smoke_pid=''
activated=0
studio_stopped=0
caddy_changed=0
shared_candidate=""
shared_active_hash=""
shared_parent_hash=""
had_caddy_config=0
[[ -f /etc/napplet-space/Caddyfile ]] && had_caddy_config=1
rollback() {
  result=$?
  trap - ERR
  [[ -z "$smoke_pid" ]] || { kill "$smoke_pid" 2>/dev/null || true; wait "$smoke_pid" 2>/dev/null || true; }
  if [[ "$caddy_changed" == 1 ]]; then
    if [[ "$proxy_mode" == shared ]]; then
      if [[ "$(sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f1)" == "$shared_active_hash" || "$(sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f1)" == "$shared_parent_hash" ]]; then
        cp -p "$app_root/shared/Caddyfile.host.previous" /etc/caddy/Caddyfile
        chmod 644 /etc/caddy/Caddyfile
      else
        echo 'Caddy parent changed concurrently; preserved the operator edit.' >&2
      fi
      if [[ "$had_caddy_config" == 1 ]]; then cp "$app_root/shared/Caddyfile.previous" /etc/napplet-space/Caddyfile; else rm -f /etc/napplet-space/Caddyfile; fi
      systemctl reload caddy || true
    elif [[ "$had_caddy_config" == 1 ]]; then
      cp "$app_root/shared/Caddyfile.previous" /etc/napplet-space/Caddyfile
      systemctl reload napplet-space-caddy || true
    else
      systemctl stop napplet-space-caddy || true
      rm -f /etc/napplet-space/Caddyfile
    fi
  fi
  [[ -z "$shared_candidate" ]] || rm -f "$shared_candidate"
  if [[ "$activated" == 0 && "$studio_stopped" == 1 && -n "$previous" ]]; then
    start_studio "$previous" || true
  fi
  if [[ "$activated" == 1 ]]; then
    [[ "$studio_configured" != 1 ]] || systemctl stop napplet-studio.service || true
    if [[ -n "$previous" ]]; then
      ln -sfn "$previous" "$app_root/current.rollback"
      mv -Tf "$app_root/current.rollback" "$app_root/current"
      pm2_run delete napplet-relay || true
      if [[ -f "$previous/infra/relay.ecosystem.config.cjs" ]]; then start_relay "$previous" || true; fi
      pm2_run delete napplet-blossom || true
      if [[ -f "$previous/infra/blossom.ecosystem.config.cjs" ]]; then start_blossom "$previous" || true; fi
      pm2_run delete napplet-grasp || true
      if [[ -f "$previous/infra/grasp.ecosystem.config.cjs" ]]; then start_grasp "$previous" || true; fi
      pm2_run delete napplet-indexer || true
      if [[ -f "$previous/infra/indexer.ecosystem.config.cjs" ]]; then start_indexer "$previous" || true; fi
      stop_cvm || true
      if [[ -f "$previous/scripts/cvm-health.ts" ]]; then start_cvm "$previous" || true; fi
      start_studio "$previous" || true
      pm2_run delete napplet-web || true
      runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$(release_bun "$previous")" SPACE_RELEASE_DIR="$previous" SPACE_RELEASE_ID="$(basename "$previous")" PATH="$previous/bin:$PATH" node "$pm2_bin" start "$previous/infra/ecosystem.config.cjs" --update-env || true
    else
      pm2_run delete napplet-web || true
      pm2_run delete napplet-relay || true
      pm2_run delete napplet-blossom || true
      pm2_run delete napplet-grasp || true
      pm2_run delete napplet-indexer || true
      stop_cvm || true
      rm -f "$app_root/current"
    fi
    pm2_run save --force || true
  fi
  echo 'Deployment failed. Previous application/configuration was restored where available.' >&2
  exit "$result"
}
trap rollback ERR

# Test the new production build before touching the active process.
runuser -u napplet -- env NODE_ENV=production PORT="$smoke_port" HOST=127.0.0.1 SPACE_RELEASE_ID="$release_id" "$bun_bin" "$release_dir/apps/web/server.ts" > "$release_dir/smoke.log" 2>&1 &
smoke_pid=$!
healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:$smoke_port/api/health 2>/dev/null | grep -Fq "\"release\":\"$release_id\""; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
# These transports now run in the browser. Do not reactivate a protocol proxy.
for endpoint in media resources relay-read; do
  code=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H "Origin: https://$domain" -H 'X-Space-Host: 1' -H 'Content-Type: application/json' --data '{' "http://127.0.0.1:$smoke_port/api/$endpoint")
  [[ "$code" == 404 ]] || { echo "Candidate still exposes the removed $endpoint proxy ($code)." >&2; exit 1; }
done
code=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$smoke_port/api/admin")
[[ "$code" == 401 ]] || { echo "Candidate administration is not protected ($code)." >&2; exit 1; }
kill "$smoke_pid"
wait "$smoke_pid" 2>/dev/null || true
smoke_pid=''

cat > "$app_root/shared/Caddyfile.next" <<CADDY
$domain {
  encode zstd gzip
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    -Server
  }
  @studio path /api/studio/*
  reverse_proxy @studio 127.0.0.1:19352
  @relay path /relay /relay/
  reverse_proxy @relay 127.0.0.1:19347
  reverse_proxy 127.0.0.1:$web_port
}
www.$domain {
  redir https://$domain{uri} permanent
}
$relay_domain {
  header -Server
  reverse_proxy 127.0.0.1:19347
}
$blossom_domain {
  header -Server
  reverse_proxy 127.0.0.1:19348
}
$git_domain {
  header -Server
  request_body {
    max_size 52428800
  }
  @private path /metrics /metrics/*
  respond @private 404
  reverse_proxy 127.0.0.1:19349
}
CADDY
shared_candidate="/etc/caddy/.napplet-$release_id"
shared_parent_hash=''
shared_active_hash=''
if [[ "$proxy_mode" == shared ]]; then
  cp -p /etc/caddy/Caddyfile "$app_root/shared/Caddyfile.host.previous"
  chmod 600 "$app_root/shared/Caddyfile.host.previous"
  shared_parent_hash=$(sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f1)
  "$bun_bin" "$release_dir/scripts/shared-caddy.ts" /etc/caddy/Caddyfile /etc/napplet-space/Caddyfile "$app_root/shared/Caddyfile.next" "$shared_candidate"
  runuser -u caddy -- /usr/bin/caddy validate --config "$shared_candidate" --adapter caddyfile
else
  "$app_root/bin/caddy" validate --config "$app_root/shared/Caddyfile.next" --adapter caddyfile
fi
if [[ "$studio_configured" == 1 ]]; then
  studio_stopped=1
  systemctl stop napplet-studio.service
fi
ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$app_root/current"
activated=1
pm2_run delete napplet-relay || true
start_relay "$release_dir"
relay_ready "$release_dir"
pm2_run delete napplet-blossom || true
start_blossom "$release_dir"
blossom_ready "$release_dir"
pm2_run delete napplet-grasp || true
printf '%s\n' "$grasp_commit" > "$state_root/grasp/upstream.commit"
chown napplet:napplet "$state_root/grasp/upstream.commit"
start_grasp "$release_dir"
grasp_ready "$release_dir"
pm2_run delete napplet-indexer || true
start_indexer "$release_dir"
indexer_ready "$release_dir"
stop_cvm
start_cvm "$release_dir"
start_studio "$release_dir"
pm2_run delete napplet-web || true
runuser -u napplet -- env PM2_HOME="$state_root/pm2" BUN_BIN="$bun_bin" SPACE_RELEASE_DIR="$release_dir" SPACE_RELEASE_ID="$release_id" PATH="$PATH" node "$pm2_bin" start "$release_dir/infra/ecosystem.config.cjs" --update-env
healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:$web_port/api/health 2>/dev/null | grep -Fq "\"release\":\"$release_id\""; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
pm2_run save

cat > /etc/systemd/system/napplet-space.service <<UNIT
[Unit]
Description=napplet.space PM2 processes
After=network.target
[Service]
Type=forking
User=napplet
Environment=PM2_HOME=$state_root/pm2
Environment=PATH=$app_root/bin:/usr/sbin:/usr/bin:/sbin:/bin
PIDFile=$state_root/pm2/pm2.pid
ExecStart=/usr/bin/node $pm2_bin resurrect
ExecStop=/usr/bin/node $pm2_bin kill
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
if [[ "$proxy_mode" == dedicated ]]; then
cat > /etc/systemd/system/napplet-space-caddy.service <<UNIT
[Unit]
Description=napplet.space Caddy HTTPS proxy
After=network-online.target
Wants=network-online.target
[Service]
User=napplet
Group=napplet
Environment=HOME=$state_root
Environment=XDG_DATA_HOME=$state_root/caddy
ExecStart=$app_root/bin/caddy run --config /etc/napplet-space/Caddyfile --adapter caddyfile
ExecReload=$app_root/bin/caddy reload --config /etc/napplet-space/Caddyfile --adapter caddyfile
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
fi
if [[ "$had_caddy_config" == 1 ]]; then cp /etc/napplet-space/Caddyfile "$app_root/shared/Caddyfile.previous"; fi
if [[ "$proxy_mode" == shared ]]; then
  [[ "$(sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f1)" == "$shared_parent_hash" ]] || { echo 'Caddy changed during deployment; refusing to overwrite it.' >&2; false; }
  "$bun_bin" "$release_dir/scripts/shared-caddy.ts" /etc/caddy/Caddyfile /etc/napplet-space/Caddyfile /etc/napplet-space/Caddyfile "$shared_candidate"
  shared_active_hash=$(sha256sum "$shared_candidate" | cut -d ' ' -f1)
  # Write the fragment first; the first installation is unreachable until its import is activated.
  caddy_changed=1
  install -m 644 "$app_root/shared/Caddyfile.next" /etc/napplet-space/Caddyfile
  install -m 644 "$shared_candidate" /etc/caddy/Caddyfile
  runuser -u caddy -- /usr/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl reload caddy
  systemctl is-active --quiet caddy
  rm -f "$shared_candidate"
else
  install -m 644 "$app_root/shared/Caddyfile.next" /etc/napplet-space/Caddyfile
  caddy_changed=1
fi
systemctl daemon-reload
systemctl enable napplet-space
if [[ "$proxy_mode" == dedicated ]]; then
  systemctl enable napplet-space-caddy
  if systemctl is-active --quiet napplet-space-caddy; then systemctl reload napplet-space-caddy; else systemctl start napplet-space-caddy; fi
  systemctl is-active --quiet napplet-space-caddy
fi
printf '%s\n' "$proxy_mode:$web_port" > "$app_root/shared/deploy-profile"
trap - ERR
bash "$release_dir/scripts/backup-install.sh"
echo "Activated $release_id for https://$domain with Blossom at https://$blossom_domain and Git at https://$git_domain. HTTPS certificate issuance depends on DNS and network reachability."
