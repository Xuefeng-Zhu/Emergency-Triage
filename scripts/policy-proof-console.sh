#!/usr/bin/env bash
# On-stage proof console: shows the sandbox's own allow/deny decision for every
# network call the agent's tooling attempts. See docs/policy-proof-console.md.
set -uo pipefail

sandbox="${NEMOCLAW_SANDBOX:-emergency-trial-agent}"
mock_lis_url="${MOCK_LIS_URL:-http://host.openshell.internal:8787/mock-lis/orders}"

# The CLI's "how to allow this host" hint is four lines of noise on stage.
export NEMOCLAW_NO_POLICY_HINT=1

# Only lines with a target; drops SSH:OPEN bookkeeping from the exec channel.
watch_stream() {
  printf '  %-8s %-46s %s\n' VERDICT TARGET 'POLICY/ENGINE'
  printf '  %s\n' '---------------------------------------------------------------------------------'
  nemoclaw "$sandbox" logs --follow --since 5s 2>&1 \
    | grep --line-buffered -E '(ALLOWED|DENIED) [^ ]+ -> ' \
    | sed -u -E 's#^.*\] (ALLOWED|DENIED) ([^ ]+) -> (.*) \[policy:([^ ]*) engine:([^]]*)\].*$#\1|\3|\2|\4/\5#' \
    | awk -F'|' '{ printf "  %-8s %-46s %s\n", $1, $2, $4; fflush() }'
}

# One line per probe: either an HTTP status or curl's transport error.
probe_one() {
  local label="$1"
  shift
  local result
  result=$(nemoclaw "$sandbox" exec -- curl -sS --max-time 10 -o /dev/null \
    -w 'http=%{http_code}' "$@" 2>&1 | tr '\n' ' ')
  printf '  %-42s %s\n' "$label" "${result:0:110}"
}

# Every probe here must be refused. Run with the watch pane visible.
probe_wall() {
  probe_one "1/4 arbitrary internet" https://example.com
  probe_one "2/4 cloud metadata (SSRF)" http://169.254.169.254/latest/meta-data/
  probe_one "3/4 package index" https://pypi.org
  echo
  echo "  4/4 permitted host AND port, wrong method/path:"
  nemoclaw "$sandbox" exec -- curl -sS --max-time 10 \
    -X GET "http://host.openshell.internal:8787/healthz" 2>&1 | tail -1
  echo
}

# The one call the envelope permits, with a forged permit: proves the request
# clears the policy and is then rejected by the LIS on its own merits.
probe_forged() {
  echo "permitted route, forged permit   -> expect ALLOWED by policy, 403 from the LIS"
  nemoclaw "$sandbox" exec -- curl -sS --max-time 10 -w '\n[http=%{http_code}]\n' \
    -X POST -H 'Content-Type: application/json' -H 'X-Order-Permit: forged' \
    --data-binary '{"proposal_id":"stage_probe","test_code":"ECG-12","label":"12-Lead ECG"}' \
    "$mock_lis_url" 2>&1 | tail -2
}

case "${1:-watch}" in
  watch) watch_stream ;;
  probe) probe_wall ;;
  forged) probe_forged ;;
  policy)
    nemoclaw "$sandbox" policy-list | grep -E '●'
    echo
    nemoclaw "$sandbox" policy-get | sed -n '/emergency_trial_mock_lis/,/binaries/p'
    ;;
  *)
    echo "usage: $0 [watch|probe|forged|policy]" >&2
    exit 2
    ;;
esac
