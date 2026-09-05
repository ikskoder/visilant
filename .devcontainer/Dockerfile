# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# Ordered from what almost never changes to what changes with the project, so a
# code edit does not rebuild the Chromium layer.

# ─────────────────────────────────────────────────────────────────────────────
# Why the plain library image and not mcr.microsoft.com/devcontainers/javascript
#
# Images built from Dev Container Features carry the Features' metadata in a
# `devcontainer.metadata` LABEL, and some of those Features declare
# `capAdd: [SYS_PTRACE]` and `securityOpt: [seccomp=unconfined]`. The Dev
# Containers extension merges that metadata and writes its own compose override
# beside ours, and Compose appends list values - so `cap_drop: ALL` in
# compose.yaml never undoes it, and the container runs with no syscall filter at
# all while the file says otherwise. Neither `LABEL devcontainer.metadata="[]"`
# here nor an empty `capAdd` in devcontainer.json removes it.
#
# The only fix that works is not to start from such an image. Everything the
# Feature would have given us is installed below instead, and
# scripts/check-workspace.sh asserts each tool on every start.
# ─────────────────────────────────────────────────────────────────────────────

USER root

# git for the repository and its hooks, jq for scripts, and unzip plus diffutils
# for scripts/verify.sh, which unpacks a store package and diffs it against a
# build. procps is for looking at what `pnpm dev` actually started.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        diffutils \
        git \
        jq \
        procps \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# The command runner and the secret scanner, checksum-pinned. See the installer.
COPY dev-tools/install-tools.sh /tmp/install-tools.sh
RUN /tmp/install-tools.sh && rm /tmp/install-tools.sh

# pnpm and the Playwright CLI, pinned by package-lock.json with per-tarball
# integrity hashes that are reviewed in git rather than trusted from the wire.
# Lifecycle scripts are off: install-time script execution is the vector this
# whole container exists to contain, and neither package needs one here.
#
# The pnpm version is deliberately the one flake.nix hands the Nix build rather
# than the newest patch. Two package managers producing two node_modules from
# one lockfile is the drift this setup is meant to prevent, and pnpm 10.22 has
# open advisories (a lifecycle-script-bypass among them) whose blast radius is
# exactly what the container already contains: no host home directory, no
# capabilities, a read-only root filesystem. Bumping it belongs with the flake
# bump that moves both at once, not here on its own.
COPY node-tools/package.json node-tools/package-lock.json /opt/visilant-node-tools/
RUN npm ci --prefix /opt/visilant-node-tools --omit=dev --ignore-scripts \
    && ln -s /opt/visilant-node-tools/node_modules/.bin/pnpm /usr/local/bin/pnpm \
    && npm cache clean --force \
    && pnpm --version

# Chromium and the shared libraries it needs, both from the pinned Playwright
# above. They live under /opt because the root filesystem is read-only at run
# time: a browser downloaded on first use would have nowhere to land, and the
# error says nothing about the real cause. check-workspace.sh compares the
# version baked here with the one pnpm-lock.yaml resolves and fails the start if
# they have moved apart, which is the only warning that a lockfile bump needs an
# image rebuild.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN /opt/visilant-node-tools/node_modules/.bin/playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Everything that writes has to be under the home volume, because the root
# filesystem is read-only at run time. pnpm keeps its content-addressed store
# and its global bin directory here, npm its cache.
ENV PNPM_HOME=/root/.local/share/pnpm
# npm's default global prefix is /usr/local, which is read-only at run time, so
# `npm install -g` cannot work at all without moving it. /root is the home
# volume, so anything installed globally survives a container restart and is
# gone when the volume is removed.
ENV NPM_CONFIG_PREFIX=/root/.local
ENV PATH=/root/.local/bin:/root/.local/share/pnpm:/usr/local/bin:$PATH

# A PATH that is right for `docker exec` and wrong for the terminal a person
# types into is the failure that reads as "it works for you and not for me".
# Set it in the file every shell form reads, then prove all of them see it.
RUN printf 'export PNPM_HOME=/root/.local/share/pnpm\nexport NPM_CONFIG_PREFIX=/root/.local\nexport PATH="/root/.local/bin:$PNPM_HOME:/usr/local/bin:$PATH"\n' \
      > /etc/profile.d/10-visilant-path.sh \
    && printf 'export PNPM_HOME=/root/.local/share/pnpm\nexport NPM_CONFIG_PREFIX=/root/.local\nexport PATH="/root/.local/bin:$PNPM_HOME:/usr/local/bin:$PATH"\n' \
      >> /etc/bash.bashrc \
    && for probe in 'sh -lc' 'bash -lc' 'bash -ic'; do \
         env -i HOME=/root TERM=dumb $probe 'command -v pnpm >/dev/null && command -v just >/dev/null' \
           || { echo "PATH is not usable in: $probe" >&2; exit 1; }; \
       done

# The extension's own version of "do not phone home during a build".
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    DO_NOT_TRACK=1

WORKDIR /workspaces/visilant
