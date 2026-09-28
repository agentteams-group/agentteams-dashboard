#!/usr/bin/env bash
# Docs consistency gate (dashboard-optimization A4, task 6.7).
# Keeps README/docs from drifting stale again:
#   1. known-stale strings that were removed must not reappear
#   2. the README "installer default" lines must match the default
#      embedded in install/agentteams-install.sh
#   3. relative links in README*/docs must point at existing files
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
err() { echo "docs-consistency: FAIL $1"; fail=1; }

# --- 1. banned stale strings ---------------------------------------------
for p in '724 tests' '724 个用例' 'DATABASE_URL' 'PowerShell support is planned' 'PowerShell 支持开发中'; do
  while IFS= read -r hit; do
    [ -n "$hit" ] && err "stale string \"$p\": $hit"
  done < <(grep -rn --include='*.md' -F "$p" README.md README.zh-CN.md docs 2>/dev/null || true)
done

# --- 2. installer default version sync -----------------------------------
installer_default="$(grep -m1 -o 'AGENTTEAMS_DASHBOARD_VERSION:-[^"}]*' install/agentteams-install.sh | sed 's/.*:-//')"
if [ -z "$installer_default" ]; then
  err 'cannot extract AGENTTEAMS_DASHBOARD_VERSION default from install/agentteams-install.sh'
else
  grep -q "Installer default.*\`$installer_default\`" README.md \
    || err "README.md installer default does not match $installer_default"
  grep -q "安装器默认版本.*\`$installer_default\`" README.zh-CN.md \
    || err "README.zh-CN.md installer default does not match $installer_default"
fi

# --- 3. relative link existence -------------------------------------------
md_files=(README.md README.zh-CN.md)
while IFS= read -r -d '' f; do md_files+=("$f"); done < <(find docs -name '*.md' -print0)

for f in "${md_files[@]}"; do
  dir=${f%/*}
  [ "$dir" = "$f" ] && dir=.
  while IFS= read -r link; do
    case "$link" in
      http://*|https://*|mailto:*|\#*) continue ;;
    esac
    target=${link%% *}
    target=${target%%#*}
    # decode percent-encoding used for special chars in repo paths ([component])
    target=${target//%5B/[}
    target=${target//%5D/]}
    target=${target//%20/ }
    [ -z "$target" ] && continue
    [ -e "$dir/$target" ] || err "broken link in $f -> $link"
  done < <(grep -oE '\]\([^)]+\)' "$f" | sed -E 's/^\]\(//; s/\)$//' || true)
done

if [ "$fail" -eq 0 ]; then
  echo "docs-consistency: OK"
else
  echo "docs-consistency: one or more checks failed (see above)"
  exit 1
fi
