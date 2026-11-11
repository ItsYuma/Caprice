#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.bun/bin:${PATH}"

reject_unknown_args() {
  local skip_value=0
  local token
  for token in "$@"; do
    if [[ "$skip_value" -eq 1 ]]; then
      skip_value=0
      continue
    fi
    case "$token" in
      --help | -h | --skip-system)
        ;;
      --model-url | --model-api-key | --model-protocol | --model-runtime | --model-executable | --model-deadline-ms | --model | --voice | --stt-engine | --stt-model | --stt-url | --stt-deadline-ms | --tts-engine | --tts-url | --tts-model | --tts-api-key | --tts-deadline-ms | --data-dir | --python | --container)
        skip_value=1
        ;;
      --model-url=* | --model-api-key=* | --model-protocol=* | --model-runtime=* | --model-executable=* | --model-deadline-ms=* | --model=* | --voice=* | --stt-engine=* | --stt-model=* | --stt-url=* | --stt-deadline-ms=* | --tts-engine=* | --tts-url=* | --tts-model=* | --tts-api-key=* | --tts-deadline-ms=* | --data-dir=* | --python=* | --container=*)
        ;;
      *)
        echo "unknown argument: ${token}"
        exit 1
        ;;
    esac
  done
  if [[ "$skip_value" -eq 1 ]]; then
    echo "missing value for the last flag"
    exit 1
  fi
}

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

os_release_path() {
  if [[ -n "${CAPRICE_OS_RELEASE:-}" ]]; then
    printf '%s' "${CAPRICE_OS_RELEASE}"
    return
  fi
  printf '%s' /etc/os-release
}

os_field() {
  local key="$1"
  local file
  file="$(os_release_path)"
  if [[ ! -r "$file" ]]; then
    printf ''
    return
  fi
  local line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "${key}="*)
        value="${line#"${key}="}"
        value="${value#\"}"
        value="${value%\"}"
        value="${value#\'}"
        value="${value%\'}"
        printf '%s' "$value"
        return
        ;;
    esac
  done < "$file"
}

rpm_query() {
  run_root dnf repoquery "$@"
}

rpm_available() {
  rpm_query --available --qf '%{name}\n' "$1" | grep -q .
}

rpm_install_available() {
  local pkg
  for pkg in "$@"; do
    if rpm_available "$pkg"; then
      run_root dnf install -y "$pkg"
    fi
  done
}

webkit_rpm() {
  echo "Looking up WebKitGTK 4.1 in the enabled dnf repositories." >&2
  if rpm_query --whatprovides 'pkgconfig(webkit2gtk-4.1)' | grep -q .; then
    printf '%s\n' 'pkgconfig(webkit2gtk-4.1)'
    return 0
  fi

  local candidate
  for candidate in webkit2gtk4.1-devel webkitgtk4.1-devel webkit2gtk4.1; do
    if rpm_available "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

el_major() {
  os_field VERSION_ID | cut -d. -f1
}

needs_fedora_container() {
  if [[ -n "${CAPRICE_CONTAINER:-}" ]]; then
    return 1
  fi
  local id major
  id="$(os_field ID)"
  major="$(el_major)"
  case "$id" in
    rocky | rhel | almalinux | centos | ol) ;;
    *) return 1 ;;
  esac
  case "$major" in
    8 | 9) ;;
    *) return 1 ;;
  esac
  if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists webkit2gtk-4.1; then
    return 1
  fi
  return 0
}

ensure_distrobox() {
  run_root dnf install -y podman fuse-overlayfs slirp4netns
  if ! command -v distrobox >/dev/null 2>&1 && [[ ! -x "${HOME}/.local/bin/distrobox" ]]; then
    run_root dnf install -y distrobox || true
  fi
  if ! command -v distrobox >/dev/null 2>&1 && [[ ! -x "${HOME}/.local/bin/distrobox" ]]; then
    curl -fsSL https://raw.githubusercontent.com/89luca89/distrobox/main/install | sh -s -- --prefix "${HOME}/.local"
  fi
  export PATH="${HOME}/.local/bin:${PATH}"
  if ! command -v distrobox >/dev/null 2>&1; then
    echo "distrobox is not installed."
    exit 1
  fi
}

ensure_rootless_podman() {
  if podman info >/dev/null 2>&1; then
    return
  fi
  local user base
  user="$(id -un)"
  base="$(($(id -u) * 65536))"
  if [[ ! -r /etc/subuid ]] || ! grep -q "^${user}:" /etc/subuid; then
    run_root usermod --add-subuids "${base}-$((base + 65535))" --add-subgids "${base}-$((base + 65535))" "$user"
  fi
  if podman info >/dev/null 2>&1; then
    return
  fi
  echo "podman cannot run as ${user}."
  podman info
  exit 1
}

container_exists() {
  distrobox list --no-color 2>/dev/null | grep -Eq '(^|[^[:alnum:]_])caprice([^[:alnum:]_]|$)'
}

create_fedora_container() {
  local image="registry.fedoraproject.org/fedora:44"
  echo "Pulling Fedora 44. Rocky Linux 9 has WebKitGTK 4.0, and the window needs 4.1."
  if distrobox create --help 2>&1 | grep -q -- '--yes'; then
    distrobox create --name caprice --image "$image" --yes
  else
    printf 'Y\n' | distrobox create --name caprice --image "$image"
  fi
}

enter_fedora() {
  local forward=()
  local skip_value=0
  local token
  for token in "$@"; do
    if [[ "$skip_value" -eq 1 ]]; then
      skip_value=0
      continue
    fi
    case "$token" in
      --skip-system)
        ;;
      --container)
        skip_value=1
        ;;
      --container=*)
        ;;
      *)
        forward+=("$token")
        ;;
    esac
  done

  echo "Rocky Linux 9 ships WebKitGTK 4.0. Caprice continues inside a Fedora container named caprice."
  ensure_distrobox
  ensure_rootless_podman
  if ! container_exists; then
    create_fedora_container
  fi

  local quoted=""
  if [[ "${#forward[@]}" -gt 0 ]]; then
    quoted="$(printf '%q ' "${forward[@]}")"
  fi
  exec_without_shell_functions distrobox enter caprice -- bash -lc "cd $(printf '%q' "$ROOT") && export CAPRICE_CONTAINER=1 && exec scripts/install.sh --container caprice ${quoted}"
}

exec_without_shell_functions() {
  local flags=()
  local entry key
  while IFS= read -r -d '' entry; do
    key="${entry%%=*}"
    case "$key" in
      BASH_FUNC_*) flags+=("-u" "$key") ;;
    esac
  done < <(env -0)
  if [[ "${#flags[@]}" -gt 0 ]]; then
    exec env "${flags[@]}" "$@"
  fi
  exec "$@"
}

install_linux_packages() {
  if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists gdk-3.0 webkit2gtk-4.1; then
    return
  fi

  local id="" like=""
  id="$(os_field ID)"
  like="$(os_field ID_LIKE)"

  case "${id} ${like}" in
    *debian* | *ubuntu* | *linuxmint* | *pop*)
      run_root apt-get update
      DEBIAN_FRONTEND=noninteractive run_root apt-get install -y \
        build-essential curl wget file pkg-config patchelf cmake \
        libssl-dev libxdo-dev libgtk-3-dev libwebkit2gtk-4.1-dev \
        libayatana-appindicator3-dev librsvg2-dev libasound2-dev \
        ca-certificates
      ;;
    *fedora* | *rhel* | *centos*)
      echo "Refreshing dnf metadata."
      run_root dnf makecache
      local webkit
      if ! webkit="$(webkit_rpm)"; then
        echo "No enabled dnf repository provides webkit2gtk-4.1."
        echo "Fedora ships it as webkit2gtk4.1-devel. Enterprise Linux 9 uses the Fedora container path instead."
        exit 1
      fi
      run_root dnf install -y \
        gcc gcc-c++ make cmake curl wget file openssl-devel gtk3-devel alsa-lib-devel \
        ca-certificates \
        "$webkit"
      rpm_install_available \
        pkgconf-pkg-config pkgconf \
        librsvg2-devel libxdo-devel \
        libayatana-appindicator-gtk3-devel libappindicator-gtk3-devel
      ;;
    *arch*)
      run_root pacman -S --needed --noconfirm \
        base-devel cmake curl wget file pkgconf openssl gtk3 webkit2gtk-4.1 alsa-lib \
        librsvg xdotool ca-certificates
      ;;
    *)
      echo "Install CMake, GTK 3, WebKitGTK 4.1, and a C compiler, then run scripts/install.sh again."
      echo "Or re-run with --skip-system if they are already installed."
      exit 1
      ;;
  esac
}

ensure_cmake() {
  if command -v cmake >/dev/null 2>&1; then
    return
  fi
  if [[ "$skip_system" -eq 1 ]]; then
    echo "CMake is required to build speech."
    exit 1
  fi

  local id="" like=""
  id="$(os_field ID)"
  like="$(os_field ID_LIKE)"

  case "${id} ${like}" in
    *debian* | *ubuntu* | *linuxmint* | *pop*)
      run_root apt-get update
      DEBIAN_FRONTEND=noninteractive run_root apt-get install -y cmake
      ;;
    *fedora* | *rhel* | *centos*)
      run_root dnf install -y cmake
      ;;
    *arch*)
      run_root pacman -S --needed --noconfirm cmake
      ;;
    *)
      echo "Install CMake, then run scripts/install.sh again."
      exit 1
      ;;
  esac

  if ! command -v cmake >/dev/null 2>&1; then
    echo "CMake is required to build speech."
    exit 1
  fi
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    if ! command -v bun >/dev/null 2>&1; then
      curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
    fi
    exec bun scripts/install.ts "$@"
  fi
done

reject_unknown_args "$@"

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
  if [[ "$skip_system" -eq 0 ]] && ! command -v cmake >/dev/null 2>&1; then
    echo "Install CMake, then run scripts/install.sh again. transcribe.cpp needs it."
    exit 1
  fi
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  if needs_fedora_container; then
    enter_fedora "$@"
  else
    if [[ "$skip_system" -eq 0 ]]; then
      install_linux_packages "$@"
    fi
    ensure_cmake
  fi
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

exec bun scripts/install.ts "$@"
