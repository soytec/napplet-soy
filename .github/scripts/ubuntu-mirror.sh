#!/usr/bin/env bash
set -euo pipefail
# GitHub's amd64 Ubuntu images use this mirror list. Keep their source paths,
# suites, components and Ubuntu signing keys intact. ARM uses ubuntu-ports.
if [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]; then
  test -f /etc/apt/apt-mirrors.txt
  printf '%s\n' 'https://mirrors.edge.kernel.org/ubuntu/' | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi
