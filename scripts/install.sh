#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"
for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    if ! command -v bun >/dev/null 2>&1; then
      curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
    fi
    exec bun scripts/install.ts "$@"
  fi
done

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_linux_packages() {
  if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists gdk-3.0 webkit2gtk-4.1; then
    if command -v python3 >/dev/null 2>&1 && python3 -c "import ensurepip" >/dev/null 2>&1; then
      return
    fi
  fi

  local id="" like=""
  if [[ -r /etc/os-release ]]; then
    id="$(. /etc/os-release && printf '%s' "${ID:-}")"
    like="$(. /etc/os-release && printf '%s' "${ID_LIKE:-}")"
  fi

  case "${id} ${like}" in
    *debian* | *ubuntu* | *linuxmint* | *pop*)
      run_root apt-get update
      DEBIAN_FRONTEND=noninteractive run_root apt-get install -y \
        build-essential curl wget file pkg-config patchelf \
        libssl-dev libxdo-dev libgtk-3-dev libwebkit2gtk-4.1-dev \
        libayatana-appindicator3-dev librsvg2-dev \
        python3 python3-venv python3-pip ca-certificates
      ;;
    *fedora* | *rhel* | *centos*)
      run_root dnf install -y \
        gcc gcc-c++ make curl wget file pkgconf-pkg-config openssl-devel \
        gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel \
        python3 python3-pip ca-certificates
      ;;
    *arch*)
      run_root pacman -S --needed --noconfirm \
        base-devel curl wget file pkgconf openssl gtk3 webkit2gtk-4.1 \
        librsvg xdotool python python-pip ca-certificates
      ;;
    *)
      echo "Install GTK 3, WebKitGTK 4.1, python3, and a C compiler, then run scripts/install.sh again."
      echo "Or re-run with --skip-system if they are already installed."
      exit 1
      ;;
  esac
}

skip_system=0
for arg in "$@"; do
  if [[ "$arg" == "--skip-system" || "$arg" == "--help" || "$arg" == "-h" ]]; then
    skip_system=1
  fi
done

if [[ "$(uname -s)" == "Darwin" ]]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install >/dev/null 2>&1 || true
    echo "Install the Xcode command line tools, then run scripts/install.sh again."
    exit 1
  fi
fi

if [[ "$(uname -s)" == "Linux" && "$skip_system" -eq 0 ]]; then
  install_linux_packages
fi

if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "1.4.4" ]]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
fi
export PATH="${HOME}/.bun/bin:${PATH}"

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
fi
if [[ -f "${HOME}/.cargo/env" ]]; then
  set +u
  source "${HOME}/.cargo/env"
  set -u
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not installed."
  exit 1
fi

exec bun scripts/install.ts "$@"
