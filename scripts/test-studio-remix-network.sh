#!/usr/bin/env bash
set -euo pipefail
# Run only inside a fresh network/mount namespace: never change the host firewall.
if [[ "${1:-}" != --inside ]]; then
  exec sudo unshare --net --mount --fork bash "$0" --inside "$(command -v bun)"
fi
studio_test_bun="$2"
mount --make-rprivate /
ip link set lo up
# An isolated public-shaped fixture address. This namespace has no external route.
ip addr add 11.51.0.1/32 dev lo
studio_test_dir="$(mktemp -d /tmp/soy-remix-network.XXXXXX)"
trap 'rm -rf "$studio_test_dir"' EXIT
chmod 755 "$studio_test_dir"
cat /etc/hosts > "$studio_test_dir/hosts"
printf '\n11.51.0.1 soy-remix.example.com\n127.0.0.1 soy-private.example.com\n' >> "$studio_test_dir/hosts"
mount --bind "$studio_test_dir/hosts" /etc/hosts
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=soy-remix.example.com \
  -addext subjectAltName=DNS:soy-remix.example.com -keyout "$studio_test_dir/key.pem" \
  -out "$studio_test_dir/cert.pem" >/dev/null 2>&1
"$studio_test_bun" apps/studio/hosting/egress.ts 65534 11.51.0.1 > "$studio_test_dir/policy.nft"
nft -f "$studio_test_dir/policy.nft"
SPACE_TEST_REMIX_NETWORK="$studio_test_dir" "$studio_test_bun" test tests/services/studio-remix-network.test.ts
