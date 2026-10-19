import { createFileRoute, Link } from '@tanstack/react-router';
import { WandSparkles, ArrowUpRight } from 'lucide-react';
import { StarterCommand } from '@/components/starter-command';
import release from '../../../cli/distribution/version.json';
import { creatorSearch } from '@/lib/creator-search';
import { SoyliIdentity } from '@/components/soyli-intro';
import { siteHead } from '@/lib/site-head';
import { StudioLink } from '@/components/studio-link';
export const Route = createFileRoute('/create')({
  validateSearch: creatorSearch,
  head: ({ match }) =>
    siteHead(
      match.context.clientPolicy.siteOrigin,
      '/create',
      'Create a napplet — napplet.soy',
      'Create with browser Studio or soyLI and your own coding tools. Preview, remix and publish your napplet.',
    ),
  component: Create,
});
function Create() {
  const { template } = Route.useSearch();
  return (
    <section className="create-page">
      <span className="eyebrow">FROM “WHAT IF” TO “LOOK AT THIS”</span>
      <h1>
        Make a little
        <br />
        something<span className="coral">.</span>
      </h1>
      <p className="create-intro">An idea is enough. Choose where you want to make it real.</p>
      <div className="creation-choices">
        <article>
          <span className="eyebrow">CHAT & PLAY · BRING YOUR API KEY</span>
          <h2>In your browser</h2>
          <p>
            Describe your idea, play the preview and keep shaping it. Connect your Nostr account and
            your own inference provider. Your private drafts stay in your Studio workspace; choose
            browser or server builds, then review before publishing.
          </p>
          <StudioLink path="/create" className="creation-choice-action">
            Create in browser →
          </StudioLink>
          <StudioLink>Continue a creation ↗</StudioLink>
        </article>
        <article>
          <span className="eyebrow">YOUR EDITOR & AI TOOLS</span>
          <h2>On your computer</h2>
          <p>
            Start a real Git project with soyLI. Use the coding agent you already like, with skills
            and publishing tools included.
          </p>
          <a href="#local-soyli" className="creation-choice-action">
            Use soyLI locally ↓
          </a>
          <span>No website account needed.</span>
        </article>
      </div>
      <h2 id="local-soyli" className="guide-heading">
        Make it with soyLI
      </h2>
      <SoyliIdentity compact />
      <p className="account-free-note">Create, remix and publish. No website account needed.</p>
      <p>
        Your code and shared Git history are open source by default. Publish your own version or
        propose improvements to the original.
      </p>
      <StarterCommand template={template} />
      <p className="command-note">
        macOS and Linux. No Bun or Node installation needed. Git is required.
      </p>
      <p className="command-note">
        Publishing uses a Nostr identity. The CLI can create one or connect yours; you don’t need to
        sign in here.
      </p>
      <nav className="creator-guide-nav" aria-label="Creator guide">
        <Link to="/docs">soyLI documentation</Link>
        <a href="#setup">Getting started</a>
        <a href="#skills">Skills & boilerplate</a>
        <a href="#platforms">System setup</a>
        <a href="#upgrade">Update soyLI</a>
        <a href="#downloads">Downloads</a>
      </nav>
      <div id="setup" className="creator-guide">
        <p className="command-note">
          The installer checks the download’s SHA-256 checksum and installs in your home folder. It
          needs no sudo and leaves shell profiles alone. Follow its PATH instruction if needed, then
          run:
        </p>
        <div className="terminal-box">
          <code>
            cd my-napplet
            <br />
            soyli dev
            <br />
            soyli build
            <br />
            soyli checkpoint "My first napplet"
            <br />
            soyli publish
          </code>
        </div>
        <div className="creation-steps">
          <article>
            <span>01</span>
            <h2>Start with a spark</h2>
            <p>
              The CLI prepares a private Node/pnpm toolchain and installs the starter’s locked
              dependencies. You get a Git repository and Napplet skills for your coding agent. No
              global Bun, Node, or npm installation is needed. The TypeScript project builds into a
              self-contained HTML napplet.
            </p>
          </article>
          <article>
            <span>02</span>
            <h2>Make it your kind of weird</h2>
            <p>
              Run <code>soyli dev</code> in the new project. Make changes with the AI tool you
              already use and see them in the sandbox preview.
            </p>
            <p>
              Create an identity or connect a remote signer. Credentials stay in your OS credential
              store. Set it up later if you just want to experiment.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Play it. Pass it around.</h2>
            <p>
              In the dev preview, switch to Listing to inspect the screenshot, title, description,
              tags and upload destinations. Capture a screenshot there before sharing. You can also
              use Record clip, or <code>soyli record</code>, to add a short silent video and review
              it alongside the cover.
            </p>
            <p>
              Build and review your changes, save a Git checkpoint, then run{' '}
              <code>soyli publish</code> to check your creation, publish to Nostr, and get a link to
              share.
            </p>
            <p>
              The first check or publication downloads a pinned Chromium browser into your cache.
              Future checks reuse it. Use <code>soyli check</code> without publishing.
            </p>
          </article>
        </div>
        <h2 id="skills" className="guide-heading">
          The upstream starter, with skills included
        </h2>
        <p className="command-note">
          New projects use a pinned version of{' '}
          <a href="https://github.com/napplet/boilerplate">napplet/boilerplate</a>, including its
          SDK, Vite plugin, documentation, and eight official Napplet skills. Open your coding agent
          in the project folder; AGENTS.md and CLAUDE.md point it to the instructions. Run{' '}
          <code>soyli run verify</code> for the upstream checks or{' '}
          <code>soyli run test:conformance</code> for its reference harness.
        </p>
        <p className="command-note">
          For an existing creation, run <code>soyli skills update</code> in its folder after
          updating the CLI. This adds the bundled skills and preserves your edits. The project’s{' '}
          <code>docs/napplet-space.md</code> explains publishing and supported host capabilities.
          Explicit example starters remain available through <code>--template</code>.
        </p>
        <h2 id="platforms" className="guide-heading">
          Settle into your system.
        </h2>
        <div className="creation-steps platform-steps">
          <article>
            <h2>macOS</h2>
            <p>
              Apple Silicon and modern Intel (AVX2) builds. Git comes with Apple Command Line Tools:
              run <code>xcode-select --install</code> if it is missing. Local private keys use your
              login Keychain. New remote signer sessions use private files outside projects;
              Keychain storage is optional.
            </p>
            <p>
              Checks and captures require macOS 12 or newer. soyLI automatically uses a frozen
              compatibility browser on macOS 12–13; macOS 14+ gets the current browser. Run{' '}
              <code>soyli doctor</code> to see which is selected. Upgrade macOS for current browser
              security updates.
            </p>
          </article>
          <article>
            <h2>Linux</h2>
            <p>
              Use an ARM64 or x86-64 (SSE4.2) glibc desktop distribution, such as Ubuntu 24.04, with
              Git. Local private keys need an unlocked Secret Service keyring and D-Bus session.
              Remote signer sessions can use private files without a desktop keyring. Chromium also
              needs system browser libraries.
            </p>
          </article>
          <article>
            <h2>Need a hand?</h2>
            <p>
              Run <code>soyli doctor</code> for Git, browser and latest-version diagnostics. Run{' '}
              <code>soyli account check</code> to verify your signer. Alpine/musl and native Windows
              packages are not supported yet.
            </p>
          </article>
        </div>
        <p className="command-note">
          On Ubuntu 24.04, Chromium’s system libraries can be installed with{' '}
          <code>
            sudo apt-get install libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64
            libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1
            libasound2t64
          </code>
          . The CLI never runs sudo for you.
        </p>
        <h2 id="upgrade" className="guide-heading">
          Keep soyLI up to date
        </h2>
        <p className="command-note">
          Run <code>soyli update</code> to install the latest stable GitHub release. Older versions
          without this command can rerun the installer from the{' '}
          <a href="https://github.com/zeSchlausKwab/napplet-soy/releases/latest">latest release</a>.
          Your identities, backups and project state stay in place; the old napplet-space command
          remains a compatibility alias. Restart running preview sessions, then run{' '}
          <code>soyli skills update</code> in each project to refresh its coding guidance.
        </p>
        <h2 id="downloads" className="guide-heading">
          Downloads · {release.version}
        </h2>
        <p className="command-note">
          Extract the whole archive, including its lib folder. Keep them together. These downloads
          include the Bun runtime.
        </p>
        <ul className="cli-downloads">
          {(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const).map((platform) => (
            <li key={platform}>
              <a
                href={`https://github.com/zeSchlausKwab/napplet-soy/releases/download/soyli-v${release.version}/soyli-${platform}.tar.gz`}
              >
                {platform.replace('darwin', 'macOS')}
              </a>
              {' · '}
              <a
                href={`https://github.com/zeSchlausKwab/napplet-soy/releases/download/soyli-v${release.version}/soyli-${platform}.tar.gz.sha256`}
              >
                SHA-256
              </a>
            </li>
          ))}
        </ul>
        <p className="command-note">
          <a href="/install.sh">Inspect the installer</a>
        </p>
      </div>
      <div className="creation-footnote">
        <WandSparkles size={22} />
        <p>
          No AI subscription bundled in. No giant framework required.
          <br />
          Your tools, your code, your little corner of the internet.
        </p>
        <a href="https://github.com/napplet" target="_blank" rel="noreferrer">
          Meet napplet <ArrowUpRight size={15} />
        </a>
      </div>
    </section>
  );
}
