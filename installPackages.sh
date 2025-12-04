#!/usr/bin/env bash
set -euo pipefail

packages=("$@")

# Check if a package is installed via dpkg
is_installed() {
  dpkg -s "$1" &>/dev/null
}

# Check for external installations
is_node_installed() {
  command -v node &>/dev/null
}

is_npm_installed() {
  command -v npm &>/dev/null
}

is_pipx_installed() {
  command -v pipx &>/dev/null
}

missing=()
for pkg in "${packages[@]}"; do
  case "$pkg" in
    nodejs)
      if ! is_node_installed && ! is_installed nodejs; then
        missing+=("$pkg")
      fi
      ;;
    npm)
      if ! is_npm_installed && ! is_installed npm; then
        missing+=("$pkg")
      fi
      ;;
    pipx)
      if ! is_pipx_installed && ! is_installed pipx; then
        missing+=("$pkg")
      fi
      ;;
    *)
      if ! is_installed "$pkg"; then
        missing+=("$pkg")
      fi
      ;;
  esac
done

if [ ${#missing[@]} -eq 0 ]; then
  echo "All packages are already installed."
  exit 0
fi

echo "Packages to be installed: ${missing[*]}"
echo "Updating apt..."
sudo apt update

echo "Installing missing packages..."
sudo apt install -y "${missing[@]}"

echo "Installation completed."
