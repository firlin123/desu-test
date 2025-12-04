#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt &>/dev/null; then
    echo "This script requires apt package manager. Exiting."
    exit 1
fi

if [[ "$EUID" -ne 0 ]] && ! command -v sudo &>/dev/null; then
    echo "This script requires sudo for non-root users. Exiting."
    exit 1
fi
TMP_FILE=""
cleanup() {
    if [[ -n "$TMP_FILE" && -f "$TMP_FILE" ]] && command -v rm &>/dev/null; then
        rm -f "$TMP_FILE"
    fi
}
trap cleanup EXIT

RAN_APT_UPDATE=0
apt_install() {
    if [[ $RAN_APT_UPDATE -eq 0 ]]; then
        echo "Updating apt..."
        if [[ "$EUID" -eq 0 ]]; then
            apt update
        else
            sudo apt update
        fi
        RAN_APT_UPDATE=1
    fi
    if [[ $# -eq 0 ]]; then
        return 0
    fi
    echo "Installing packages:" "$@"
    if [[ "$EUID" -eq 0 ]]; then
        apt install -y "$@"
    else
        sudo apt install -y "$@"
    fi
}

install_commands() {
    local MISSING=()
    local HAS_NPM=0
    for CMD in "$@"; do
        if [[ "$CMD" == "node" ]]; then
            HAS_NPM=1
        fi
        if ! command -v "$CMD" &>/dev/null; then
            MISSING+=("$CMD")
        fi
    done
    if [[ ${#MISSING[@]} -eq 0 ]]; then
        if [[ -f "package.json" && $HAS_NPM -eq 1 ]] && command -v npm &>/dev/null; then
            echo "Installing npm packages..."
            npm install
        fi
        echo "All commands are already installed."
        return 0
    fi

    local -A PACKAGES=()
    for CMD in "${MISSING[@]}"; do
        case "$CMD" in
            \[|arch|b2sum|base32|base64|basename|basenc|cat|chcon|chgrp|chmod|chown|cksum|comm| \
            cp|csplit|cut|date|dd|df|dir|dircolors|dirname|du|echo|env|expand|expr|factor|false| \
            fmt|fold|groups|head|hostid|id|install|join|link|ln|logname|ls|md5sum|mkdir|mkfifo| \
            mknod|mktemp|mv|nice|nl|nohup|nproc|numfmt|od|paste|pathchk|pinky|pr|printenv|printf| \
            ptx|pwd|readlink|realpath|rm|rmdir|runcon|seq|sha1sum|sha224sum|sha256sum|sha384sum| \
            sha512sum|shred|shuf|sleep|sort|split|stat|stdbuf|stty|sum|sync|tac|tail|tee|test| \
            timeout|touch|tr|true|truncate|tsort|tty|uname|unexpand|uniq|unlink|users|vdir|wc| \
            who|whoami|yes)
                PACKAGES["coreutils"]=1
                ;;
            free|kill|pgrep|pidwait|pmap|ps|pwdx|skill|slabtop|tload|top|uptime|vmstat|w|watch)
                PACKAGES["procps"]=1
                ;;
            node)
                PACKAGES["nodejs"]=1
                ;;
            google-chrome)
                PACKAGES["google-chrome-stable"]=1
                ;;
            *)
                PACKAGES["$CMD"]=1
                ;;
        esac
    done
    
    echo "Packages to be installed: ${!PACKAGES[*]}"
    if [[ -n "${PACKAGES[google-chrome-stable]:-}" ]]; then
        local SUB_INSTALLS=()
        if ! command -v curl &>/dev/null; then
            SUB_INSTALLS+=("curl")
        fi
        if ! command -v mktemp &>/dev/null; then
            SUB_INSTALLS+=("coreutils")
        fi
        if [[ ${#SUB_INSTALLS[@]} -gt 0 ]]; then
            apt_install "${SUB_INSTALLS[@]}"
        fi
        for PKG in "${SUB_INSTALLS[@]}"; do
            if [[ -n "${PACKAGES[$PKG]:-}" ]]; then
                unset PACKAGES["$PKG"]
            fi
        done
        unset SUB_INSTALLS
        echo "Downloading Google Chrome deb package..."
        TMP_FILE=$(mktemp --suffix=.deb)
        curl -fL -o "$TMP_FILE" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
        unset PACKAGES["google-chrome-stable"]
        PACKAGES["$TMP_FILE"]=1
    fi
    local HAD_IA=0
    if [[ -n "${PACKAGES[ia]:-}" ]]; then
        HAD_IA=1
        unset PACKAGES["ia"]
    fi
    if [[ ${#PACKAGES[@]} -gt 0 ]]; then
        apt_install "${!PACKAGES[@]}"
    fi
    if [[ $HAD_IA -eq 1 ]]; then
        if ! command -v pipx &>/dev/null; then
            apt_install pipx
        fi
        echo "Installing Internet Archive CLI..."
        pipx install internetarchive
    fi
    if [[ -f "package.json" && $HAS_NPM -eq 1 ]] && command -v npm &>/dev/null; then
        echo "Installing npm packages..."
        npm install
    fi
}

install_commands "$@"