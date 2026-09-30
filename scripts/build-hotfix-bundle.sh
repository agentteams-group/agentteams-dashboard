#!/bin/sh
# build-hotfix-bundle.sh — assemble the in-app hot-patch bundle for a release.
#
# The bundle mirrors the RUNNING app directory layout (standalone server.js +
# node_modules + .next incl. static, plus public/), so applying it over the
# container's workdir is a straight hot swap.
#
# Usage:
#   npm run build                    # or: make build (standalone output)
#   sh scripts/build-hotfix-bundle.sh v1.2.5 [out-dir]
#
# Produces:
#   dashboard-hotfix-v1.2.5.tar.gz
#   dashboard-hotfix-v1.2.5.tar.gz.sha256
#
# Upload both as release assets of the v1.2.5 release — /api/self-update
# discovers them by name (prefix configurable via DASHBOARD_HOTFIX_ASSET_PREFIX).

set -eu

VERSION="${1:?usage: build-hotfix-bundle.sh vX.Y.Z [out-dir]}"
OUT_DIR="${2:-.}"
mkdir -p "$OUT_DIR"

if [ ! -f .next/standalone/server.js ]; then
  echo "ERROR: .next/standalone/server.js not found — run 'npm run build' first." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Standalone tree (server.js, node_modules subset, .next server chunks)
cp -r .next/standalone/. "$STAGE/"

# Next standalone does not embed public/ and .next/static — they are copied
# into the image separately, so the bundle carries them the same way.
if [ -d public ]; then
  mkdir -p "$STAGE/public"
  cp -r public/. "$STAGE/public/"
fi
if [ -d .next/static ]; then
  mkdir -p "$STAGE/.next/static"
  cp -r .next/static/. "$STAGE/.next/static/"
fi

TAR_NAME="dashboard-hotfix-${VERSION}.tar.gz"
echo "==> Packing ${OUT_DIR}/${TAR_NAME}"
tar -czf "${OUT_DIR}/${TAR_NAME}" -C "$STAGE" .

echo "==> Checksum"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "${TAR_NAME}" > "${TAR_NAME}.sha256")
else
  (cd "$OUT_DIR" && shasum -a 256 "${TAR_NAME}" > "${TAR_NAME}.sha256")
fi

echo "==> Done:"
ls -lh "${OUT_DIR}/${TAR_NAME}" "${OUT_DIR}/${TAR_NAME}.sha256"
