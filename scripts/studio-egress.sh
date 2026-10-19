#!/usr/bin/env bash
# Installed root-owned as /usr/local/libexec/napplet-studio-egress.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Apply Studio egress as root.' >&2; exit 1; }
policy=/etc/napplet-space/studio.nft
[[ -f $policy && ! -L $policy && $(stat -c %u "$policy") == 0 ]] || exit 1
[[ $(stat -c %a "$policy") == 644 ]] || exit 1
# All replacement rules are committed atomically. A failed update keeps the old rules.
/usr/sbin/nft list table inet soy_studio >/dev/null 2>&1 || /usr/sbin/nft add table inet soy_studio
{ printf 'delete table inet soy_studio\n'; cat "$policy"; } | /usr/sbin/nft -f -
