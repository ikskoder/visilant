#!/usr/bin/env bash
# Refuse to commit a path that only exists on one particular computer.
#
# Container files are where this leaks: a bind mount, a cache directory, a
# scratch path copied out of a terminal. It is not a secret, so the secret
# scanner has no opinion about it, and it is not wrong, so nothing fails - it
# just tells everyone who reads the repository where the author keeps their
# files, and it stops working for anybody else.
#
# The patterns below are either generic shapes (`/home/<something>/`) or derived
# at run time from this machine (its hostname, the committer's e-mail, where the
# repository sits). Nothing personal is written down in this file, which would
# rather defeat the point.
#
#   check-no-host-paths.sh --staged   what this commit adds   (the git hook)
#   check-no-host-paths.sh --tree     every file git would keep   (CI)
set -uo pipefail

mode="${1:---staged}"

if [[ -n "${VISILANT_ALLOW_HOST_PATHS:-}" ]]; then
  echo "check-no-host-paths: SKIPPED because VISILANT_ALLOW_HOST_PATHS is set." >&2
  echo "  Nothing was checked. This is not a clean result." >&2
  exit 0
fi

die() { echo "check-no-host-paths: $*" >&2; exit 2; }

patterns=(
  # A home directory belonging to a named account. `/root` is deliberately not
  # here: it is the home directory inside the container and appears all over
  # .devcontainer/ for good reason.
  '/home/[A-Za-z0-9._-]+'
  '/Users/[A-Za-z0-9._-]+'
  # Mount points that are a property of one machine's disks.
  '/mnt/[A-Za-z0-9._-]+'
  '/media/[A-Za-z0-9._-]+'
  # Per-session runtime directory, keyed by uid.
  '/run/user/[0-9]+'
  # A Nix store path names one build on one machine.
  '/nix/store/[a-z0-9]{32}-'
)

# Derived from this machine, so the value is never spelled out in this file.
#
# The escaping here is one backslash, not two. Written `\\\\&` the sed
# replacement emits TWO literal backslashes, and `\\.` in an extended regular
# expression means "a literal backslash followed by any character" rather than
# "a literal dot" - so every derived pattern silently matched nothing. That bug
# shipped in the first version of this file and made the e-mail and checkout
# guarantees pure decoration. Any change here needs the self-test below to pass.
add_derived() {
  local value="$1"
  # Too short to be distinctive, and a false positive would be constant.
  [[ ${#value} -ge 5 ]] || return 0
  # No `/` in the set: it is not a metacharacter in an extended regular
  # expression, and escaping it makes grep warn "stray \ before /" on every
  # single line it reads.
  patterns+=("$(printf '%s' "$value" | sed 's/[][\.*^$(){}?+|\\]/\\&/g')")
}
# Inside the dev container two of these describe the container rather than the
# developer: the hostname is a throwaway hex id, and the checkout sits at
# /workspaces/visilant, which is the deliberately machine-independent path that
# every file under .devcontainer/ is supposed to contain. Deriving from them in
# here flagged the container's own compose.yaml and Dockerfile as leaks.
#
# The e-mail is the same in both places, so it stays. The authoritative runs are
# the pre-commit hook and CI, both of which are outside the container and get
# the full set - but a reduced set must say so rather than look identical to a
# complete one.
derived_note=""
if [[ -e /.dockerenv || -e /run/.containerenv ]]; then
  derived_note="  (in a container: hostname and checkout-path patterns are off, they would describe the container)"
else
  add_derived "$(hostname 2>/dev/null || true)"
  add_derived "$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi
add_derived "$(git config user.email 2>/dev/null || true)"

joined=$(printf '%s|' "${patterns[@]}")
joined="${joined%|}"

# A URL is not a filesystem path, and several here legitimately carry something
# that looks like one - the VirusTotal links in the e2e suite, and the made-up
# file: URL in the history-import test, both matched before this existed. So the
# network schemes are stripped from a line before it is judged.
#
# `file://` is deliberately NOT stripped. On this project the single most likely
# real leak is a README line reading "load the unpacked extension from" and
# then a file: URL naming somebody's home directory, and treating that as a URL
# would wave through exactly the case this check exists for.
sanitize() {
  sed -E 's#(https?|ftps?|wss?|git\+ssh|ssh|svn|rsync)://[^[:space:]"'"'"'`,)]*##g'
}

hits=0

# A line carrying this marker is deliberately exempt. There are two honest
# reasons for one: a fixture that has to contain a path-shaped string to test
# something (the history-import test proves a file: URL yields no hostname), and
# the examples inside this file itself. A waiver goes on the line, in
# the diff, where a reviewer sees it - which is the whole difference between
# this and quietly loosening a pattern until nothing complains.
WAIVER='host-path-ok'

# Prints the offending substring on success, nothing on failure.
match_in() {
  case "$1" in
    *"$WAIVER"*) return 0 ;;
  esac
  printf '%s\n' "$1" | sanitize | grep -oE "$joined" | head -1
}

report() {  # report <where> <text> <matched>
  hits=$((hits + 1))
  printf '  %s: %s\n' "$1" "$(printf '%s' "$2" | sed 's/^[[:space:]]*//' | cut -c1-120)" >&2
  printf '      matched: %s\n' "$3" >&2
}

case "$mode" in
  --staged)
    # The added lines of what is about to be committed. Content, not file names:
    # a diff of a binary file has no `+` lines at all, and `--name-only` escapes
    # non-ASCII paths in a way that is awkward to feed back into anything.
    current=""
    while IFS= read -r line; do
      case "$line" in
        '+++ b/'*) current="${line#+++ b/}" ;;
        '+++ '*)   current="${line#+++ }" ;;
        '+'*)
          text="${line#+}"
          found=$(match_in "$text")
          [[ -n "$found" ]] && report "$current" "$text" "$found"
          ;;
      esac
    done < <(git -c core.quotepath=false diff --cached --unified=0 --no-color)
    ;;
  --tree)
    # Everything git would keep, which is NOT the same as everything git tracks.
    # `git grep` only looks at tracked files, and the first version of this
    # script used it - so a brand new, untracked .devcontainer/ full of bind
    # mounts was reported as "clean (tree)" without a single byte being read.
    # A file that is about to be added is exactly the one worth checking.
    list=$(mktemp) || die "cannot create a temporary file"
    trap 'rm -f "$list"' EXIT
    if ! git -c core.quotepath=false ls-files -z --cached --others --exclude-standard > "$list"; then
      die "git ls-files failed - nothing was checked."
    fi
    files=()
    while IFS= read -r -d '' f; do
      # A tracked file deleted in the working copy is still listed.
      [[ -f "$f" ]] && files+=("$f")
    done < "$list"

    for f in "${files[@]}"; do
      # -I skips binary files. grep exits 0 on a match, 1 on none, and 2 or more
      # on a real failure - and a failure must not read as "found nothing",
      # which is what `2>/dev/null` on its own would have made it.
      out=$(grep -I -n -E -e "$joined" -- "$f" 2>/dev/null); rc=$?
      if [[ $rc -gt 1 ]]; then
        die "grep failed on $f (exit $rc) - the scan is incomplete, so nothing is being reported as clean."
      fi
      [[ $rc -eq 0 ]] || continue
      while IFS= read -r hit; do
        lineno="${hit%%:*}"
        text="${hit#*:}"
        found=$(match_in "$text")
        [[ -n "$found" ]] && report "$f:$lineno" "$text" "$found"
      done <<< "$out"
    done
    ;;
  --self-test)
    # The check that the check works. Every pattern class gets a line that must
    # be caught and, where it is easy to get wrong, a line that must not be.
    fails=0
    must_hit() {
      [[ -n "$(match_in "$1")" ]] || { echo "  MISSED: $1" >&2; fails=$((fails + 1)); }
    }
    must_miss() {
      local m; m=$(match_in "$1")
      [[ -z "$m" ]] || { echo "  FALSE POSITIVE on: $1 (matched $m)" >&2; fails=$((fails + 1)); }
    }
    # Assembled rather than written out, so that these lines do not themselves
    # trip the scan when it reads this file.
    h='/home'; m='/mnt'; u='/Users'; r='/run/user'; n='/nix/store'
    must_hit "  - $h/someone/projects/x:/workspaces/x"
    must_hit "cache in $m/storage/scratch"
    must_hit "socket at $r/1000/bus"
    must_hit "built as $n/2bwd09p3yxlb4y8v35bwmb1dlsrgkf2c-visilant-firefox-3.0.0"
    must_hit "mac path $u/somebody/Code"
    # The one that matters most here: a "load the unpacked extension from ..."
    # line is the likeliest real leak in this repository, and it is a file: URL.
    must_hit "load from file://$h/you/projects/visilant/extension/"
    must_hit "$(git config user.email)"
    if [[ -z "$derived_note" ]]; then
      must_hit "$(hostname)"
      must_hit "$(git rev-parse --show-toplevel)"
    else
      echo "  (hostname and checkout-path cases skipped: not applicable in a container)"
    fi
    must_miss "see https://www.virustotal.com/gui$h/url for more"
    must_miss "the home directory inside the container is /root"
    must_miss "just a sentence with no paths in it at all"
    must_miss "a fixture path $h/user/a.pdf  # $WAIVER"
    if [[ $fails -eq 0 ]]; then
      echo "check-no-host-paths: self-test passed.$derived_note"
      exit 0
    fi
    echo "check-no-host-paths: SELF-TEST FAILED, $fails case(s). The check cannot be trusted." >&2
    exit 1
    ;;
  *)
    echo "Usage: $0 [--staged|--tree|--self-test]" >&2
    exit 2
    ;;
esac

if [[ $hits -gt 0 ]]; then
  echo >&2
  echo "check-no-host-paths: $hits line(s) name a path that exists on one machine only." >&2
  echo >&2
  echo "  What to do instead:" >&2
  echo "    - in compose files, use \${HOME} or a path relative to the repository," >&2
  echo "      and put anything genuinely machine-specific in" >&2
  echo "      .devcontainer/compose.override.yaml, which is gitignored," >&2
  echo "    - in scripts, work the location out at run time from where the" >&2
  echo "      repository actually sits, rather than writing it down," >&2
  echo "    - in documentation, write <your checkout> rather than the real path." >&2
  echo >&2
  echo "  If a hit is genuinely fine, VISILANT_ALLOW_HOST_PATHS=1 skips this check" >&2
  echo "  for one command - and says so, loudly, rather than reporting a pass." >&2
  exit 1
fi

echo "check-no-host-paths: clean (${mode#--})."
if [[ -n "$derived_note" ]]; then
  echo "$derived_note"
fi
# Explicit, because the last command of a script decides its status and a bare
# `[[ -n "$x" ]] && echo` above returned 1 whenever $x was empty - which made
# every clean run on the host look like a failure and would have blocked every
# commit.
exit 0
