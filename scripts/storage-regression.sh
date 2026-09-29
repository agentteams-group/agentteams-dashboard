#!/usr/bin/env bash
# Storage-plane manual smoke checks (task 16 / design.md §3.3.4 items #2 #3 #7).
# Read-only: safe to run against a live deployment. Automated counterparts
# live in src/__tests__/integration/storage-regression.test.ts
# (STORAGE_REGRESSION=1 npm run test:integration).
#
# Usage:
#   BASE_URL=http://localhost:3000 STORAGE_BUCKET=agentteams-storage \
#     ./scripts/storage-regression.sh
# Authenticated deployments export COOKIE='agentteams_session=...' first.
set -u -o pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BUCKET="${STORAGE_BUCKET:-agentteams-storage}"
PASS=0
FAIL=0

section() { echo ""; echo "== $1 =="; }
pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

command -v curl >/dev/null || { echo "curl is required"; exit 1; }

smoke() {
  local url="$1"
  local args=(curl -s -o /dev/null -w '%{http_code}' --max-time 30)
  [ -n "${COOKIE:-}" ] && args+=(-H "Cookie: ${COOKIE}")
  args+=("${url}")
  local code
  code="$("${args[@]}" 2>/dev/null || true)"
  echo "${code:-000}"
}

section "#2 presign chain"
code=$(smoke "${BASE_URL}/api/agentteams/storage/presign?bucket=${BUCKET}&key=smoke/probe.txt")
if [ "$code" = "200" ] || [ "$code" = "401" ]; then pass "presign GET -> ${code} (200 live, 401 unauthenticated)"; else fail "presign GET -> ${code}"; fi

code=$(smoke "${BASE_URL}/api/agentteams/storage/presign?bucket=${BUCKET}&key=workers%2Fservice-account.token")
if [ "$code" = "404" ] || [ "$code" = "401" ]; then pass "sensitive-key presign -> ${code} (404 deny, 401 unauthenticated)"; else fail "sensitive-key presign -> ${code}"; fi

section "#3 storage management routes"
for path in "buckets" "buckets/${BUCKET}/stats" "buckets/${BUCKET}/objects?prefix=smoke/"; do
  code=$(smoke "${BASE_URL}/api/agentteams/storage/${path}")
  if [ "$code" = "200" ] || [ "$code" = "401" ]; then pass "GET ${path%%\?*} -> ${code}"; else fail "GET ${path%%\?*} -> ${code}"; fi
done

section "#7 health probe (dashboard -> backend reachability)"
code=$(smoke "${BASE_URL}/api/agentteams/infrastructure")
if [ "$code" = "200" ] || [ "$code" = "401" ]; then pass "infrastructure endpoint -> ${code}"; else fail "infrastructure endpoint -> ${code}"; fi

echo ""
TOTAL=$((PASS + FAIL))
echo "Result: ${PASS}/${TOTAL} passed"
[ "${FAIL}" -eq 0 ] || exit 1
