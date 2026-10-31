#!/usr/bin/env bash
# Install / update dsh-archived-sessions in the DSH desktop profile.
#
# The profile's cordis.patch.yml is watched: saving it re-composes the Loader
# within about a second, so no app restart is needed for the HOST half. The
# browser half arrives through the client-module graph (refresh the page with
# Ctrl+R if the Settings section does not appear by itself).
#
# NOTE: this uses the manual mount row. Do NOT also add the package to
# `dsh.profile.bundles` in the profile package.json — the bundle patch inserts
# the same id and two inserts of one id fail the plugin tree at boot.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
dest="$profile/node_modules/dsh-archived-sessions"
patch="$profile/cordis.patch.yml"

mkdir -p "$profile/node_modules"
rm -rf "$dest"
mkdir -p "$dest"
cp -r "$here/package.json" "$here/README.md" "$here/cordis.patch.yml" "$here/lib" "$dest/"

if grep -q "name: 'dsh-archived-sessions'" "$patch" 2>/dev/null; then
  echo "mount row already present"
else
  cp "$patch" "$patch.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
  cat >> "$patch" <<'EOF'

- insert:
    - id: archived-sessions
      name: 'dsh-archived-sessions'
EOF
  echo "appended mount row to $patch"
fi

echo "installed to $dest"
