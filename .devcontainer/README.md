# The dev container

## What it is for

`pnpm install` runs about a thousand packages of other people's code, and every `pnpm dev`, `eslint`, `vitest` and `playwright` run after it executes more of the same. On the host that code runs as you, with read access to your ssh keys, your GitHub and npm tokens, your browser profiles and every other project on the machine. That is the thing this container removes, and it is the only thing it is for.

It is deliberately *not* about reproducible builds. Those are already handled, and better: `nix build .#firefox` runs in the Nix sandbox, and both the dependency fetch and the build call `pnpm install --ignore-scripts`, so no package's lifecycle script runs at all on the release path. The gap was never the release. It was the working day.

## What runs where, and why

| | where |
|---|---|
| `pnpm install`, `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e` | container |
| `just nf` / `nc` / `nk` / `verify` – the Nix release build | **host** |
| `just ar` / `ae` – the phone | **host** |
| Loading the built extension into a browser | **host**, from `extension/` |

Two of those cannot move, and it is worth knowing why rather than trying again later.

**The Nix build needs user namespaces, and this container cannot have them.** A user namespace is how the kernel gives a process its own view of users and mounts, and the Nix sandbox is built on one. Measured on this machine, on rootless Docker 29.6: `unshare -Ur` fails with `Operation not permitted` with the default capabilities, with `cap_drop: ALL`, and with `no-new-privileges` – and succeeds only under `seccomp=unconfined`, which removes the syscall filter entirely. Trading the filter away for a build that is already sandboxed elsewhere is a bad trade, so the Nix build stays outside.

**The phone needs its USB device.** `just ar` drives adb against a device node under `/dev/bus/usb`, and passing a device through is a privilege grant.

**Loading the extension into a browser** happens on the host because `extension/` is on the bind mount: a build made in the container is visible to a browser on the host straight away, with nothing to copy.

## Using it

```
just container-build              # once, and after any change under .devcontainer/
just container-up
just c pnpm install --frozen-lockfile   # ONCE per container: node_modules is a
                                        # volume of its own and starts empty
just container-shell              # a shell inside
just c pnpm test run              # or run one plain command without a shell
just container-check              # re-run the start-up checks
just container-down               # stop, keeping the volumes
```

`just c` substitutes its arguments into a shell line on the host, so anything with quotes, pipes, apostrophes or `&&` in it belongs in `just container-shell` instead.

Opening the folder in VS Code does the install for you: `postCreateCommand` runs `pnpm install --frozen-lockfile` and then the checks.

`postCreateCommand` and `postStartCommand` both run `check-workspace.sh`, so the same checks apply whichever way the container was started – which matters, because the extension writes compose overrides of its own and the CLI does not.

## node_modules is not shared, on purpose

The container has its own `node_modules` on a named volume, and the host keeps the one in the working copy.

pnpm records the absolute path of its store in `node_modules/.modules.yaml` and rebuilds the whole directory when that path changes. The same folder sits under your projects directory on the host and at `/workspaces/visilant` in here, so one shared `node_modules` would belong to whichever side installed last and every switch would cost a full reinstall. The first attempt did not even get that far: pnpm refused to continue and asked to remove the host's copy.

Both sides genuinely need one, because `just ar` runs web-ext from the host's `node_modules` and cannot move in here. So they get one each, from one shared `pnpm-lock.yaml`. `extension/`, `src/` and the lockfile itself are all on the bind mount, which is what actually matters.

The consequence to remember: **a lockfile change needs `pnpm install` on both sides.**

## What the hardening actually does

Every line here was checked in a running container rather than trusted from the file, and `just container-check` re-runs the machine-readable half on every start.

- `read_only: true` – the root filesystem rejects writes. Everything that legitimately writes is a volume: `/root` (the pnpm store, the npm cache, shell history, git config), `node_modules`, and the editor server.
- `/tmp`, `/var/tmp` and `/run` are tmpfs with `noexec,nosuid`. Writing a binary to `/tmp` and running it is the usual next step after a dropper lands, and it fails here.
- `cap_drop: ALL` – `CapBnd` on PID 1 reads `0000000000000000`.
- `no-new-privileges:true` – `NoNewPrivs: 1`, so a setuid binary cannot hand a capability back.
- The default seccomp profile is on – `Seccomp: 2`. This is the one that quietly disappears if the image is ever rebased onto a Dev Container Features image, and the comment at the top of `Dockerfile` explains how.
- `pids_limit: 1024`, `mem_limit: 8g`, `cpus: 8`, which is half the machine's cores so a build does not take the laptop with it. cgroup v2 counts threads rather than processes and Chromium has a great many of them, so the usual 512 was not obviously enough: sampled through a full e2e run (104 tests, 3.4 minutes) `pids.current` peaked at 178, and the limit is a wide margin over that rather than a guess.
- `shm_size: 1gb`. Docker's default of 64 MB is not enough for Chromium: the renderer dies mid-test and Playwright reports it as a page closing on its own, which reads as a flaky test rather than as a missing megabyte.
- No `ports:`. `pnpm dev` is five `vite build --watch` processes writing files, not a server, so there is nothing to publish. If one is ever needed, write it as `"127.0.0.1:3303:3303"` – the short form binds `0.0.0.0` and inserts its own firewall rules, so a host firewall does not save you.
- `user: root` under **rootless** docker, which maps container uid 0 to your host account: files written into the bind are yours, and an escape lands as your account rather than as host root. On a rootful daemon this inverts and the service has to run as `node` instead. `check-workspace.sh` reads `/proc/self/uid_map` and says which daemon it found.

## No path from anybody's machine goes in here

`compose.yaml` names no directory that exists on one computer only, not even through `${HOME}`. Anything of that shape goes in `compose.override.yaml`, which is gitignored, and `compose.override.yaml.example` shows the pattern. `scripts/check-no-host-paths.sh` enforces this on every commit and in CI, and it derives the machine-specific patterns at run time from the hostname, the git e-mail and where the checkout sits, so the check itself spells nothing out.

## Things that are true of one machine only

Two places exist for anything that belongs to your setup rather than to the project, and both are gitignored:

- `compose.override.yaml` – extra mounts, environment, an `env_file`. `docker compose` run from this directory picks it up automatically, which is what every `just container-*` recipe does. `compose.override.yaml.example` shows the shape.
- `local/` – anything else: scripts, notes, a tool you install for yourself.

Tools installed with `npm install -g` inside the container land in `/root/.local`, which is on the `home` volume, so they survive a restart and an image rebuild and go when the volume does. That is deliberate: it is where something unpinned and personal belongs, rather than in the image, where it would be a pin the whole project has to carry.

## Pins, and how to move them

| what | where | how to check it is current |
|---|---|---|
| base image | `compose.yaml`, `BASE_IMAGE`, by digest | `docker buildx imagetools inspect node:<v>-bookworm-slim` |
| Node | the base image tag | must equal `engines.node` in `package.json`, which follows `flake.lock` |
| pnpm | `node-tools/package.json` | must equal `packageManager` in `package.json` |
| Playwright | `node-tools/package.json` | must equal what `pnpm-lock.yaml` resolves |
| just, gitleaks | `dev-tools/install-tools.sh`, with sha256 | the projects' release pages |

The first four are compared against the project's own files on every container start, and a mismatch fails the start with the exact edit to make. Nothing compares the last two, so those are the ones to look at deliberately.

## What this does NOT protect against

Read this part. A container that is trusted for more than it does is worse than none.

**The container can write every file in the repository, and the host executes several of them.** The bind mount is read-write and container root is your host account, so a compromised dependency inside the container can write `.git/hooks/pre-commit`, or `.git/config` (an `[alias]` starting with `!` is a shell command), or `justfile`, `scripts/*.sh`, `flake.nix`, `.envrc`. All of those run on the **host**, outside the container, with your keys and tokens. Measured: from inside the container, `.git/hooks`, `.git/config`, `justfile`, `scripts/pre-commit.sh` and `flake.nix` are all writable, and a file written there appears on the host owned by your account.

This is inherent to a bind-mounted dev container rather than a mistake in this one, and it cannot be closed without giving up the bind that makes the whole arrangement useful. What the container does buy is real and worth having: the dependency tree can no longer read `~/.ssh`, the agent tokens, the browser profiles or the other twenty projects. What it does not buy is immunity for the host from the repository itself.

**The everyday loop still needs `pnpm install` on the host too.** `just ar` runs web-ext from the host's `node_modules`, and the editor's TypeScript server and ESLint read the same tree. So install scripts still run on the host unless you ask for `pnpm install --frozen-lockfile --ignore-scripts` there - which is worth doing, with one consequence to know about: it also skips this project's own `postinstall`, so `simple-git-hooks` will not install the pre-commit hook. Run `pnpm exec simple-git-hooks` once afterwards to put it back.

**The container has outbound network access.** It needs the npm registry and the advisory feed, and nothing here filters what else it could reach. A compromised dependency inside cannot read your home directory, but it can still talk to the internet.

**gitleaks is a different build in different places** – 8.30.1 in the image, and whatever `flake.lock` pins in the devshell and therefore in CI. Both are recent. Keeping them identical would mean a rule nobody enforces, so they are allowed to differ.

**`.eslintcache` is shared and keyed by absolute path.** It lives on the bind mount, and ESLint keys its entries by absolute file path - which differs between the host and `/workspaces/visilant`. Alternating sides means `pnpm lint` is always a cold cache and each run rewrites the file. Harmless, but it explains why the cache never seems to help.

**Disk.** The image is 1.4 GB. The volumes start at roughly 1.6 GB and grow with whatever gets installed into them - the editor server alone is about 0.6 GB once VS Code has connected once, and anything installed globally inside the container lands on the `home` volume as well. Measured here after a while in use: 1.4 GB image, 1.3 GB `home`, 0.8 GB `node_modules`, 0.6 GB `vscode-server`, so about 4 GB, on top of the host's own 2.1 GB of `node_modules` that this design deliberately keeps. `just container-down` keeps the volumes, `docker compose -f .devcontainer/compose.yaml down -v` removes them.

## The pnpm advisories

`pnpm audit` on this project reports nothing about pnpm itself, because pnpm is not one of the project's dependencies – it comes from `flake.lock`. Checked separately, pnpm 10.22.0 falls inside the vulnerable range of a long list of advisories fixed in 10.34.5, including a bypass of the "lifecycle scripts are off by default" behaviour and several lockfile-integrity bypasses.

The image ships 10.22.0 anyway, deliberately: it is the version the Nix release build uses, and two package managers building two `node_modules` trees from one lockfile is a worse problem than the one being avoided. Most of what those advisories buy an attacker, running a script at install time or writing outside `node_modules`, is what this container already contains. Fixing it properly means moving `flake.lock`, which moves Node and pnpm together, and that is a change of its own.
