#!/usr/bin/env bash
# Operator-only, initial hosted Studio provisioning. Does not start Studio or change Caddy.
set -euo pipefail
image=${1:?exact local image ID required}
profile=${2:?standard or legacy-x64 required}
origin=${3:?canonical HTTPS shell origin required}
relay=${4:?public WSS relay required}
shift 4
[[ $EUID == 0 && $image =~ ^sha256:[a-f0-9]{64}$ ]] || exit 2
[[ $profile == standard || $profile == legacy-x64 ]] || exit 2
[[ $# -gt 0 ]] || { echo 'Pass the host IPv4 DNS resolver addresses.' >&2; exit 2; }
source_root=$(cd "$(dirname "$0")/.." && pwd)
app_root=/opt/napplet-space
volume=/var/lib/napplet-studio
config=/etc/napplet-space/studio.json
[[ ! -e $config ]] || { echo 'Studio already configured; inspect its existing config before changing it.' >&2; exit 1; }
for cmd in docker nft systemctl python3 fallocate mkfs.ext4 mountpoint; do command -v "$cmd" >/dev/null; done
# This one-GiB volume cannot consume the site's remaining disk as drafts accumulate.
available=$(df -PB1 "$app_root" | awk 'NR==2 {print $4}')
[[ $available -ge 4294967296 ]] || { echo 'At least four GiB free disk is required before provisioning Studio.' >&2; exit 1; }
[[ $(docker image inspect "$image" --format '{{index .Config.Labels "soy.studio.profile"}}') == "$profile" ]] || { echo 'Image profile label mismatch.' >&2; exit 1; }
[[ ! -e $app_root/studio-volume.ext4 && ! -e $volume ]] || { echo 'Studio storage already exists; preserve and inspect it.' >&2; exit 1; }
getent passwd napplet-studio >/dev/null || useradd --system --home-dir "$volume" --shell /usr/sbin/nologin napplet-studio
usermod -aG docker napplet-studio
uid=$(id -u napplet-studio)
install -d -m 755 /etc/napplet-space /usr/local/libexec
# Validate the full operator contract and egress text before allocating storage.
export STUDIO_INSTALL_IMAGE="$image" STUDIO_INSTALL_PROFILE="$profile" STUDIO_INSTALL_ORIGIN="$origin" STUDIO_INSTALL_RELAY="$relay"
python3 - "$config.next" <<'PY'
import json,os,sys,urllib.parse
origin=os.environ['STUDIO_INSTALL_ORIGIN'];relay=os.environ['STUDIO_INSTALL_RELAY']
for value,scheme in [(origin,'https'),(relay,'wss')]:
 u=urllib.parse.urlsplit(value)
 assert u.scheme==scheme and u.hostname and '.' in u.hostname and not u.username and not u.password and not u.port and not u.query and not u.fragment
assert origin==urllib.parse.urlunsplit(('https',urllib.parse.urlsplit(origin).netloc,'','',''))
image=os.environ['STUDIO_INSTALL_IMAGE'];profile=os.environ['STUDIO_INSTALL_PROFILE']
value=dict(origin=origin,port=19352,directory='/var/lib/napplet-studio/data',libraryRoot='/opt/napplet-space/studio-libraries/'+image[7:],soyli=['/opt/napplet-space/current/bin/bun','--no-env-file','/opt/napplet-space/current/apps/cli/src/index.ts'],image=image,profile=profile,relays=[relay],controlRelay='ws://127.0.0.1:19351',admitted=['*'],networkPolicy='public-https-only')
with open(sys.argv[1],'x') as f: json.dump(value,f,indent=2)
PY
"$app_root/current/bin/bun" "$source_root/apps/studio/hosting/egress.ts" "$uid" "$@" > /etc/napplet-space/studio.nft.next
nft --check -f /etc/napplet-space/studio.nft.next
library="$app_root/studio-libraries/${image#sha256:}"
[[ ! -e $library ]] || { echo 'Library destination already exists; inspect it.' >&2; exit 1; }
install -d -m 755 "$library/node_modules/@napplet"
# Export just the trusted compiler libraries; no container executes project input here.
docker run --rm --pull=never --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=1000:1000 --entrypoint=/bin/sh "$image" -ec 'cd "$(dirname "$(readlink -f /opt/profile/node_modules/@napplet/sdk)")"; exec tar -ch sdk nap core' | tar -xf - -C "$library/node_modules/@napplet"
chmod -R a+rX "$library"
fallocate -l 1G "$app_root/studio-volume.ext4"
chmod 600 "$app_root/studio-volume.ext4"
mkfs.ext4 -q -m 0 "$app_root/studio-volume.ext4"
install -d -m 700 "$volume"
mount_unit=$(systemd-escape --path --suffix=mount "$volume")
cat > "/etc/systemd/system/$mount_unit" <<UNIT
[Unit]
Description=Bounded private Studio storage
Before=napplet-studio.service
[Mount]
What=$app_root/studio-volume.ext4
Where=$volume
Type=ext4
Options=loop,nodev,nosuid
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "$mount_unit"
mountpoint -q "$volume"
chown napplet-studio:napplet-studio "$volume"
chmod 700 "$volume"
install -d -o napplet-studio -g napplet-studio -m 700 "$volume/data" "$volume/tmp"
install -o root -g root -m 755 "$source_root/scripts/studio-egress.sh" /usr/local/libexec/napplet-studio-egress
install -o root -g root -m 644 /etc/napplet-space/studio.nft.next /etc/napplet-space/studio.nft
install -o root -g root -m 644 "$source_root/infra/studio.service" /etc/systemd/system/napplet-studio.service
install -o root -g napplet-studio -m 640 "$config.next" "$config"
rm /etc/napplet-space/studio.nft.next "$config.next"
systemctl daemon-reload
systemctl enable napplet-studio.service
printf 'Studio provisioned. Deploy the verified release to start it and enable its proxy route.\n'
