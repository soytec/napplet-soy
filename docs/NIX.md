# soyLI with Nix

The repository is a Nix flake that builds soyLI from source for `x86_64-linux` and
`aarch64-linux`. macOS is not packaged yet: it needs the separate Playwright
compatibility build that the release archives ship for older Macs. Use the
[installer](CLI.md#requirements-and-storage) there.

```sh
nix run github:soytec/napplet-soy -- new my-napplet
nix profile install github:soytec/napplet-soy
```

## NixOS

```nix
{
  inputs.soyli.url = "github:soytec/napplet-soy";

  outputs = { nixpkgs, soyli, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      modules = [
        soyli.nixosModules.default
        { programs.soyli.enable = true; }
      ];
    };
  };
}
```

| Option                          | Default       | Effect                                                                                                                                     |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `programs.soyli.enable`         | `false`       | Installs `soyli` (and the legacy `napplet-space` alias) system-wide.                                                                       |
| `programs.soyli.package`        | flake package | The soyLI package to install.                                                                                                              |
| `programs.soyli.keyring.enable` | `true`        | Enables GNOME Keyring as the Secret Service used for local private keys. Disable it when another provider such as KeePassXC is configured. |

The module adds no service. Without a desktop session, local private keys need an
unlocked Secret Service on a D-Bus session bus. Remote-signer file sessions need
neither, and `SOYLI_DANGEROUS_PLAINTEXT_KEYS=1` remains the explicit development
fallback. `overlays.default` provides `pkgs.soyli` for other configurations.

## What differs from the release archive

The package compiles `apps/cli` with the same pinned Bun 1.3.11 and embedded preview
as the release build, with `--distribution nix`. The executable and its `lib/`
support files live in the store. The `soyli` wrapper supplies:

- **Project toolchain:** `SOYLI_NODE` and `SOYLI_PNPM` point at nixpkgs Node and the
  pinned pnpm tarball, so nothing is downloaded or extracted at runtime. The Node
  version is still checked against `apps/cli/vendor/toolchain.json`. The writable
  toolchain cache (`~/.cache/napplet-space/toolchains`) holds only the pnpm link
  and Rust helper tools.
- **Browser:** `PLAYWRIGHT_BROWSERS_PATH` defaults to nixpkgs' Playwright Chromium
  for the same Playwright version. `soyli run test:conformance` checks the
  project's own Playwright driver and reuses its compatible headless Chromium
  and FFmpeg without running the installer or writing into the store. A missing
  or mismatched browser reports `CONFORMANCE_BROWSER` before the project script
  starts. Update the flake/package and rebuild, align the project's Playwright
  version, or set `PLAYWRIGHT_BROWSERS_PATH` to an existing compatible cache.
  Nix builds never auto-download browsers for this command. Ordinary release
  installations still download missing compatible browsers automatically.
- **Credentials:** libsecret and glib are on the loader path that `Bun.secrets` uses.
  soyLI restores the caller's `LD_LIBRARY_PATH` for the programs it starts
  (Git, browser openers, coturn), so they do not inherit those libraries.
- **Git:** nixpkgs Git is appended to `PATH` as a fallback; a Git already on `PATH`
  is preferred.

`soyli update` refuses with `UPDATE_INSTALLATION` and points to the flake input or
profile instead; `soyli doctor` still reports the latest published release. Update
with `nix flake update soyli` and a rebuild, or `nix profile upgrade`.

The contributor reported a closure of about 1.5 GiB, mostly Chromium and its
headless shell. Its size varies with the pinned dependencies. The release archive
would otherwise download these browsers on first use.

## Maintaining the package

The build intentionally fails when nixpkgs drifts from the CLI's pins:
`nodejs_24` must equal the Node pin in `toolchain.json`, and `playwright-driver`
must equal `@playwright/test`. Update the pins and nixpkgs together.

`soyli-node-modules` is a fixed-output derivation of `bun install` over the
manifests and `bun.lock`. The pinned Bun 1.3.11 races while linking its
package store ([upstream issue](https://github.com/oven-sh/bun/issues/30209)),
and the outcome depends on download timing. A slow local network can reproduce
one result every time while CI gets another. The build normalizes the two
affected kinds of output:

- Executable links between cyclic peer dependencies (`browserslist`,
  `webpack`, ...) appear inconsistently. The build deletes every `.bin`
  directory inside `node_modules/.bun/*/node_modules`. Those directories only
  serve lifecycle scripts, which `--ignore-scripts` skips. Top-level and
  workspace `.bin` links are kept.
- The `playwright-core-mac-compat` alias and the real `playwright-core` race
  for the store's fallback `node_modules/.bun/node_modules/playwright-core`
  link. The build points it at the `@playwright/test` version.

Remove these workarounds once the Bun pin includes the upstream fix. To check
for new races, install repeatedly with a warm `BUN_INSTALL_CACHE_DIR` and
compare `nix hash path` results. Cold installs on a slow network can hide them.

Before pushing changes to dependencies, Nix inputs, CLI/shared source, embedded
creator guides or preview assets, run the same deterministic validation as CI:

```sh
bun run check:nix
# Or without Bun installed:
bash scripts/nix-check.sh
```

The script first realizes `nodeModules` and `soyli`, then builds both again with
`--rebuild` so cached fixed-output dependencies cannot hide stale hashes. Finally
it runs `nix flake check`, including the NixOS VM regressions on x86_64 Linux
(requires KVM). Checks run for the host system, not both supported architectures.
The scripts anchor to the checkout and use `path:.`, including new and unstaged
files; nothing is staged or pushed, and no `result` link is created. The package
source is limited to build inputs so unrelated docs and maintenance scripts do
not invalidate the compiled package.

After a dependency change causes a `nodeModules` hash mismatch:

```sh
bun run update:nix-hashes
# Or: bash scripts/nix-update-hashes.sh
```

The updater checks the dependency output, forcing a rebuild if it is cached,
and only replaces `nodeModules.outputHash` in `nix/package.nix` when Nix reports
a hash mismatch for that exact derivation. Unrelated errors are preserved and
do not trigger edits. It then runs the full check above. Review the diff before
committing; a verification failure leaves the edited hash in place for inspection
and does not mean the package is verified. This command does not update
`flake.lock`; use `nix flake update` deliberately and rerun validation.

Changing the Bun pin in `package.json` also needs the two Bun release hashes in
`nix/package.nix` (`nix store prefetch-file <url>`).

```sh
nix build .#soyli && ./result/bin/soyli doctor
nix flake check path:.   # ordinary check without forced rebuilds
```

The VM test (`nix/test.nix`) checks offline doctor, the Nix-managed update refusal,
the shell's browser check and the actual upstream `soyli run test:conformance`
command with packaged Chromium, actionable recovery for an incompatible browser
cache, setup and scripts with the store toolchain, and an account key stored
through GNOME Keyring. The upstream fixture is assembled from pinned npm
archives at build time; the VM needs no network access and creates no browser
cache. The `soyLI Nix` GitHub workflow runs these checks on Linux for changes to
packaging, dependency pins, CLI code or its bundled preview.
