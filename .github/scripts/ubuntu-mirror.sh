#!/usr/bin/env bash
set -euo pipefail
# GitHub's amd64 Ubuntu images use this mirror list. Keep their source paths,
# suites, components and Ubuntu signing keys intact. ARM uses ubuntu-ports.
if [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]; then
  test -f /etc/apt/apt-mirrors.txt
  printf '%s\n' 'https://mirrors.edge.kernel.org/ubuntu/' | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
elif [[ "$(uname -s)" == Linux && "$(uname -m)" == aarch64 ]]; then
  # ports.ubuntu.com has also failed DNS on the hosted ARM runners. MIT mirrors
  # the ports archive; apt still verifies Ubuntu's original signed metadata.
  test -f /etc/apt/sources.list.d/ubuntu.sources
  sudo sed -i -E 's|https?://ports\.ubuntu\.com/ubuntu-ports|https://mirrors.mit.edu/ubuntu-ports|g' /etc/apt/sources.list.d/ubuntu.sources
fi
