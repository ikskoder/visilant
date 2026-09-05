#!/usr/bin/env bash
# The one command to run before a dependency bump, from a git hook, and in CI.
#
# Three things are checked and they are reported separately, because the useful
# distinction is not "clean or not" but "which of these actually looked":
#
#   secrets      gitleaks, over what is staged or over the whole history
#   host paths   check-no-host-paths.sh
#   advisories   pnpm audit
#
# The rule the whole script is built around: a check that did not run must never
# read as a check that passed. A missing tool, an unreachable registry and a
# clean result are three different outcomes and are printed as three different
# things. Locally that is a loud warning, because the same script has to stay
# usable on a machine that has none of the tools. In CI it is a hard failure -
# set VISILANT_AUDIT_STRICT=1.
set -uo pipefail

cd "$(dirname "$0")/.."

strict="${VISILANT_AUDIT_STRICT:-}"
mode="${1:-}"

problems=0
skipped=0

hr()   { printf '\n%s\n' "── $* ──────────────────────────────────────────" ; }
bad()  { echo "  $*" >&2; problems=$((problems + 1)); }
skip() { echo "  $*" >&2; skipped=$((skipped + 1)); }

# ── secrets ──────────────────────────────────────────────────────────────────
hr "secrets"
if command -v gitleaks >/dev/null 2>&1; then
  # `gitleaks git`, never `gitleaks dir`: the directory scanner has no
  # .gitignore support and no flag to add one, so it walks node_modules and the
  # pnpm store, takes minutes, and reports build artefacts as private keys.
  # Coverage is identical - anything that can reach git is either in history
  # already or staged right now.
  # The exit code, not the output. `grep -q "leaks found"` also matches the
  # words "no leaks found", which is how this reported a clean repository as a
  # finding the first time it ran.
  if [[ "$mode" == "--staged" ]]; then
    scan_out=$(gitleaks git . --staged --redact --no-banner 2>&1); scan_rc=$?
    scan_label="staged changes"
  else
    scan_out=$(gitleaks git . --redact --no-banner 2>&1); scan_rc=$?
    scan_label="history"
  fi
  if [[ $scan_rc -eq 0 ]]; then
    echo "  $scan_label: clean"
  elif [[ $scan_rc -eq 1 ]]; then
    printf '%s\n' "$scan_out" | tail -30 >&2
    bad "gitleaks found something in the $scan_label."
  else
    # Any other code means gitleaks itself failed, which is not the same as
    # finding nothing and must not be reported as one.
    printf '%s\n' "$scan_out" | tail -10 >&2
    skip "gitleaks exited $scan_rc - it did not complete, so nothing was checked."
  fi
else
  skip "gitleaks is not installed, so NOTHING was checked for keys or tokens."
  skip "  On the host it comes from the Nix devshell - run inside 'nix develop'."
fi

# ── host paths ───────────────────────────────────────────────────────────────
hr "paths belonging to one machine"
if [[ -x scripts/check-no-host-paths.sh ]]; then
  # The checker checks itself first. Its patterns are assembled at run time from
  # the hostname, the committer's e-mail and where the checkout sits, and one of
  # them was silently matching nothing for a while because of an escaping slip -
  # a check in that state is indistinguishable from a clean repository. So a
  # handful of strings that must be caught, and a handful that must not, are run
  # through it on every commit before its answer is believed.
  if ! ./scripts/check-no-host-paths.sh --self-test > /tmp/hostpath-selftest.$$ 2>&1; then
    cat /tmp/hostpath-selftest.$$ >&2
    rm -f /tmp/hostpath-selftest.$$
    bad "the host-path checker failed its own self-test, so its verdict means nothing."
  else
    rm -f /tmp/hostpath-selftest.$$
    if [[ "$mode" == "--staged" ]]; then
      ./scripts/check-no-host-paths.sh --staged || bad "host paths in the staged changes."
    else
      ./scripts/check-no-host-paths.sh --tree || bad "host paths in the files git would keep."
    fi
  fi
else
  # A missing check script is not a pass. Exiting 0 here would look exactly like
  # a clean scan to everything downstream.
  bad "scripts/check-no-host-paths.sh is missing or not executable."
fi

# ── advisories ───────────────────────────────────────────────────────────────
hr "dependency advisories"
if command -v pnpm >/dev/null 2>&1; then
  report=$(pnpm audit --json 2>/dev/null)
  # An unreachable registry is its own answer, not an empty one. Deliberately no
  # --ignore-registry-errors: that turns "could not look" into "found nothing".
  if [[ -z "$report" ]] || ! printf '%s' "$report" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})' 2>/dev/null; then
    skip "pnpm audit produced nothing readable - the registry was probably"
    skip "  unreachable. No advisory check was performed."
  else
    # One pass: the human-readable listing on stdout, and the count of things
    # that are actually actionable on a final marker line.
    #
    # The marker is the point. Without it, a node script that printed half the
    # advisories and then died would leave `blocking` empty, `${blocking:-0}`
    # would read as "0", and this section would print "nothing high or critical"
    # over a scan that never finished - the same shape of bug as reporting
    # "no leaks found" as a finding, in the other direction.
    listing=$(printf '%s' "$report" | node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const j = JSON.parse(s);
        // npm-audit v6 shape, which is what pnpm 10 emits. If a future pnpm
        // moves to the v7 "vulnerabilities" key this finds nothing, so the
        // count in metadata is compared against it below rather than trusted
        // to agree by luck.
        const adv = Object.values(j.advisories || {});
        const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
        let blocking = 0;
        for (const a of adv) {
          // "<0.0.0" is how the feed says there is no fixed version at all.
          const fixable = a.patched_versions && a.patched_versions !== "<0.0.0";
          console.log(`  ${String(a.severity).padEnd(8)} ${a.module_name} ${a.vulnerable_versions}` +
                      `  ${fixable ? "fix: " + a.patched_versions : "NO FIX PUBLISHED"}`);
          console.log(`           ${a.title}`);
          if (a.url) console.log(`           ${a.url}`);
          if (fixable && rank[a.severity] >= rank.high) blocking++;
        }
        if (!adv.length) console.log("  no advisories");
        const counts = j.metadata && j.metadata.vulnerabilities;
        const claimed = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
        console.log(`__BLOCKING__=${blocking}`);
        console.log(`__SEEN__=${adv.length}`);
        console.log(`__CLAIMED__=${claimed === null ? "" : claimed}`);
      });
    ') || listing=""
    blocking=$(printf '%s' "$listing" | sed -n 's/^__BLOCKING__=//p')
    seen=$(printf '%s' "$listing" | sed -n 's/^__SEEN__=//p')
    claimed=$(printf '%s' "$listing" | sed -n 's/^__CLAIMED__=//p')
    printf '%s\n' "$listing" | grep -v '^__[A-Z]*__='

    if [[ -z "$blocking" ]]; then
      # No marker means the reader did not reach its own last line.
      skip "the advisory report could not be read to the end - nothing was checked."
    elif [[ -n "$claimed" && "$claimed" != "$seen" ]]; then
      # The registry says one number and the parser found another, which means
      # the report is in a shape this script does not understand any more.
      skip "pnpm reports $claimed advisory(ies) but only $seen could be read."
      skip "  The audit output format has changed - this script needs updating,"
      skip "  and until then it is not checking what it says it checks."
    elif [[ "$blocking" != "0" ]]; then
      bad "$blocking high or critical advisory(ies) with a published fix. Bump them."
    else
      echo "  nothing high or critical that has a fix available."
      echo "  (anything above marked NO FIX PUBLISHED cannot be bumped away, so it is"
      echo "   not treated as blocking - it starts blocking the day a fix lands.)"
    fi
  fi
else
  skip "pnpm is not on PATH, so no advisory check was performed."
fi

# ── the verdict, which has to distinguish three outcomes ─────────────────────
echo
if [[ $problems -gt 0 ]]; then
  echo "audit: $problems problem(s) found." >&2
  exit 1
fi
if [[ $skipped -gt 0 ]]; then
  if [[ -n "$strict" ]]; then
    echo "audit: $skipped check(s) COULD NOT RUN, and VISILANT_AUDIT_STRICT is set." >&2
    exit 1
  fi
  echo "audit: no findings, but $skipped check(s) DID NOT RUN - see above." >&2
  echo "       This is not a clean bill of health." >&2
  exit 0
fi
echo "audit: clean."
