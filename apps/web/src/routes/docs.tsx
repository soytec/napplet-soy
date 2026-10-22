import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import { DocCommand } from '@/components/doc-command';
import { createCommand } from '@/lib/creator-commands';
import { SoyliBenefits, SoyliIdentity } from '@/components/soyli-intro';
import { siteHead } from '@/lib/site-head';
import discoveryRelays from '../../../../packages/nostr/discovery-relays.json';

const description =
  'The napplet soyLI field guide: create, preview, publish and collaborate. Manage identities, preserve keys and choose where your work goes.';
export const Route = createFileRoute('/docs')({
  head: ({ match }) =>
    siteHead(
      match.context.clientPolicy.siteOrigin,
      '/docs',
      'soyLI documentation — napplet.soy',
      description,
    ),
  component: Documentation,
});

const sections = [
  ['start', 'Get started'],
  ['workflow', 'The everyday loop'],
  ['identities', 'Identities & backups'],
  ['previews', 'Previews & assets'],
  ['destinations', 'Where your work goes'],
  ['collaboration', 'Remix & contribute'],
  ['backend', 'Scores & multiplayer'],
  ['controllers', 'Game controllers'],
  ['help', 'Updates & troubleshooting'],
  ['lifecycle', 'Unpublish & delete'],
] as const;

function Documentation() {
  return (
    <article className="docs-page">
      <header className="docs-intro">
        <span className="eyebrow">NAPPLET SOYLI / DOCUMENTATION</span>
        <SoyliIdentity />
        <h1>
          Your idea. Your agent.
          <br />
          The rest comes ready<span className="coral">.</span>
        </h1>
        <p>
          Give your coding agent the context and tools to finish the job. soyLI prepares the
          project, supplies Napplet skills, captures covers and preview videos, and checks your
          creation before publishing. A few simple commands, from first idea to shared napplet.
        </p>
        <div className="docs-intro-links">
          <span>
            <BookOpen size={16} aria-hidden="true" /> No website account needed.
          </span>
          <Link to="/about" hash="faq">
            Start with the FAQ <ArrowUpRight size={15} />
          </Link>
        </div>
        <SoyliBenefits />
      </header>
      <div className="docs-layout">
        <nav className="docs-contents" aria-label="Documentation sections">
          <span className="eyebrow">IN THIS GUIDE</span>
          <ol>
            {sections.map(([id, title], index) => (
              <li key={id}>
                <a href={`#${id}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {title}
                </a>
              </li>
            ))}
          </ol>
          <Link to="/create" hash="downloads">
            Setup & downloads <ArrowUpRight size={14} />
          </Link>
        </nav>
        <div className="docs-body">
          <section id="start" aria-labelledby="docs-start">
            <span className="eyebrow">01 / FIRST SPARK</span>
            <h2 id="docs-start">From an idea to a folder.</h2>
            <p>
              Run this in your terminal. It installs soyLI and prepares a new project with the
              maintained Napplet boilerplate and skills for your coding agent.
            </p>
            <DocCommand label="Install and create">{createCommand()}</DocCommand>
            <p>
              macOS and Linux, with Git installed. You do not need a global Bun or Node
              installation. Follow the installer’s PATH instruction if it prints one.{' '}
              <Link to="/create" hash="platforms">
                System requirements and downloads
              </Link>
              .
            </p>
            <DocCommand label="Open the preview">{'cd my-napplet\nsoyli dev'}</DocCommand>
            <p>
              Open your editor or agent in that same folder. <code>AGENTS.md</code> and{' '}
              <code>CLAUDE.md</code> point to the bundled skills. The preview uses the same host
              capabilities as the website.
            </p>
            <p>
              Already installed? Use <code>soyli new my-napplet</code>. You can choose to set up an
              identity later and start experimenting straight away.
            </p>
          </section>
          <section id="workflow" aria-labelledby="docs-workflow">
            <span className="eyebrow">02 / MAKE · CHECK · SHARE</span>
            <h2 id="docs-workflow">The everyday loop.</h2>
            <p>
              Keep <code>soyli dev</code> running while you edit. It rebuilds and reloads the
              preview. When you are ready to share, stop it and check your work.
            </p>
            <DocCommand label="Build and check">
              {'soyli build\nsoyli run verify\nsoyli check'}
            </DocCommand>
            <p>
              <code>verify</code> runs the starter’s checks. <code>check</code> inspects the built
              napplet in our host; it cannot test every interaction. Play it yourself and inspect
              the Listing preview too.
            </p>
            <p>
              Run <code>soyli run test:conformance</code> for the starter’s upstream protocol
              checks. These checks complement publication validation; they do not guarantee that
              every interaction works on every client.
            </p>
            <p>
              Prefer Rust or Bevy? soyLI also supports a pinned Rust/WASM build recipe using the
              same setup, build, preview and publishing commands. Read{' '}
              <a href="https://github.com/soytec/napplet-soy/blob/main/docs/WASM.md">
                the Rust/WASM guide
              </a>{' '}
              or <code>docs/napplet-wasm.md</code> in your project. The initial profile uses
              single-threaded WebGL2 and embeds the executable in one HTML file. Rust creators need
              Rustup; players do not.
            </p>
            <DocCommand label="Save and publish">
              {
                'git status\ngit diff\nsoyli checkpoint "Ready to share"\nsoyli publish --dry-run\nsoyli publish'
              }
            </DocCommand>
            <p>
              <code>checkpoint</code> stages your source changes and makes an ordinary Git commit.
              Review changed and untracked files first. It stays local until you push, propose or
              publish. Ordinary Git commits work too.
            </p>
            <p>
              <code>publish --dry-run</code> shows the release plan and destinations. Publication
              requires a clean, committed tree, builds the project, checks the playable result,
              uploads files and source, and publishes its signed Nostr listing.
            </p>
            <aside className="docs-note">
              <strong>Open by default.</strong> Published source and pushed Git history are public,
              including earlier commits and deleted files. New projects use MIT; remixes retain
              their license. Keep secrets and private notes out of Git.
            </aside>
          </section>
          <section id="identities" aria-labelledby="docs-identities">
            <span className="eyebrow">03 / YOUR SIGNATURE</span>
            <h2 id="docs-identities">Choose who you publish as.</h2>
            <p>
              A creator identity is a Nostr key pair. Your <code>npub</code> is public; your{' '}
              <code>nsec</code> is the private key. You can create a pseudonym without adding a
              name, email or profile.
            </p>
            <h3>See or switch your identity</h3>
            <DocCommand label="List your identities">
              {'soyli account show\nsoyli account list'}
            </DocCommand>
            <p>
              Copy an account ID or npub from the list and replace <code>YOUR_ACCOUNT_ID</code>{' '}
              below.
            </p>
            <DocCommand label="Switch identity">
              {'soyli account use YOUR_ACCOUNT_ID\nsoyli account check'}
            </DocCommand>
            <p>
              Selection is shared by soyLI projects on that network. Your next publication uses the
              selected account. A running publication keeps the account it started with, even if you
              switch while it is checking or uploading.
            </p>
            <h3>Create another identity</h3>
            <p>
              <code>soyli account create</code> creates a key only when no identity is selected.
              Otherwise it reuses the selection. The new <code>soyli account create --new</code>{' '}
              option creates and selects another key while preserving earlier accounts and backups.
            </p>
            <aside className="docs-note">
              <strong>Each public key has its own releases.</strong> Switching to a remote signer
              for the same public key continues the same listing. A different public key creates a
              separate listing and Git repository; it does not transfer or delete the original. You
              can switch back later to continue the original history in the same folder.
            </aside>
            <h3>Preserve your key</h3>
            <DocCommand label="Locate your backup">{'soyli account backup'}</DocCommand>
            <p>
              Local signing keys live in your OS credential store. Creation also saves an
              unencrypted, owner-only <code>.nsec</code> backup outside your project and prints its
              path. Keep a private copy. The CLI prints the path, never the key.
            </p>
            <DocCommand label="Make an encrypted backup">
              {'soyli account export "$HOME/my-napplet-recovery.ncryptsec"'}
            </DocCommand>
            <p>
              Choose a new filename; the export asks for a passphrase. Restore through{' '}
              <code>soyli account import</code>, which asks for your key or encrypted recovery text
              at a hidden prompt. Remote identities are backed up in the signer that holds them.
            </p>
            <h3>Bring an existing signer</h3>
            <dl className="docs-reference">
              <div>
                <dt>
                  <code>soyli account connect</code>
                </dt>
                <dd>Paste a bunker link at the hidden prompt.</dd>
              </div>
              <div>
                <dt>
                  <code>soyli account pair</code>
                </dt>
                <dd>Approve the generated connection link or QR in a NIP-46 signer.</dd>
              </div>
              <div>
                <dt>
                  <code>soyli account import</code>
                </dt>
                <dd>Import an nsec or encrypted recovery key into your OS credential store.</dd>
              </div>
            </dl>
            <p>
              New remote connections use a private session file outside your project. Your Nostr
              private key stays with the signer, and publishing needs no Keychain access. Add{' '}
              <code>--session-storage keychain</code> to connect or pair if you prefer the OS vault.
              Use <code>soyli account show</code> to see the current choice.
            </p>
            <DocCommand label="Move an existing remote session out of Keychain">
              {'soyli account storage file'}
            </DocCommand>
            <p>
              This keeps your existing pairing. Allow access to the old vault once; subsequent
              publishing reads the private file. Local private-key accounts keep using the OS vault.
            </p>
            <p>
              Website sign-in is separate. Use the identity button to select a saved account or
              connect one there. It does not change soyLI’s selected creator.
            </p>
          </section>
          <section id="previews" aria-labelledby="docs-previews">
            <span className="eyebrow">04 / THE FIRST IMPRESSION</span>
            <h2 id="docs-previews">Check the whole listing.</h2>
            <p>
              In <code>soyli dev</code>, switch from Play to Listing to inspect the name,
              description, tags, creator, cover, video and upload destinations. Edit portable
              metadata in <code>napplet.json</code>.
            </p>
            <DocCommand label="Capture previews">
              {'soyli build\nsoyli screenshot\nsoyli record'}
            </DocCommand>
            <p>
              The screenshot is a PNG; the optional clip is a short, silent WebM. Both are selected
              in <code>napplet.json</code>. Review them before your next checkpoint. Existing files
              are preserved: use a new name such as <code>soyli screenshot preview-2.png</code> for
              another capture.
            </p>
            <p>
              A changed build needs a fresh clip, or you can remove <code>preview.video</code>.
              Without a selected cover, publication captures one automatically. A deliberately
              chosen scene usually makes a better first impression.
            </p>
            <h3>Sounds, images, fonts and other files</h3>
            <p>
              Keep small assets in <code>src/assets/</code> and import them through the starter’s
              build, for example <code>import imageUrl from './assets/player.png?url'</code>. CSS
              font URLs work too. The single-file build embeds them in the finished HTML.
            </p>
            <p>
              Simply dropping a file next to the napplet or using a <code>/assets/…</code> path does
              not make it available after publication. Larger external resources need the supported
              resource/media capabilities and their declared requirements. See the{' '}
              <a href="https://github.com/soytec/napplet-soy/blob/main/docs/ASSETS.md">
                asset guide
              </a>{' '}
              for supported workflows and limits.
            </p>
          </section>
          <section id="destinations" aria-labelledby="docs-destinations">
            <span className="eyebrow">05 / OUT INTO THE WORLD</span>
            <h2 id="docs-destinations">See where your work goes.</h2>
            <DocCommand label="Inspect and configure destinations">
              {'soyli config\nsoyli config init'}
            </DocCommand>
            <p>
              <code>config</code> shows effective destinations. <code>config init</code> saves
              editable overrides in the ignored <code>.napplet-space/project.json</code> file; it
              does not upload anything. This local binding also keeps publication identity separate
              from shared source.
            </p>
            <dl className="docs-reference">
              <div>
                <dt>Relay</dt>
                <dd>
                  <code>wss://relay.napplet.soy</code> receives signed listings and metadata.
                </dd>
              </div>
              <div>
                <dt>Blossom</dt>
                <dd>
                  <code>https://blossom.napplet.soy</code> stores HTML, source archives, covers and
                  clips.
                </dd>
              </div>
              <div>
                <dt>Git / GRASP</dt>
                <dd>
                  <code>https://git.napplet.soy</code> holds public source history for Git and ngit
                  clients.
                </dd>
              </div>
            </dl>
            <p>
              These are defaults. New projects include {discoveryRelays.length} additional relay
              copies:{' '}
              {discoveryRelays.map((relay, index) => (
                <span key={relay}>
                  {index > 0 && ', '}
                  <code>{relay}</code>
                </span>
              ))}
              . The optional <code>mirrors</code> list adds copies after the primary publication
              succeeds; existing project lists stay as configured. You can use other compatible
              providers; changing an existing relay or Git repository needs an explicit migration,
              not just a retry with new settings.
            </p>
            <p>
              Publication returns a portable Nostr address and a release link. To claim a readable{' '}
              <code>/@handle/slug</code> route, open your napplet page, connect its creator identity
              and choose Named link. The name follows later releases.
            </p>
          </section>
          <section id="collaboration" aria-labelledby="docs-collaboration">
            <span className="eyebrow">06 / BUILD ON AN IDEA</span>
            <h2 id="docs-collaboration">Remix first. Choose where it goes.</h2>
            <p>
              Use Make it yours on a napplet page for an install-and-remix command, or replace{' '}
              <code>NAPPLET_LINK</code> below with its URL.
            </p>
            <DocCommand label="Remix a napplet">
              {'soyli remix NAPPLET_LINK my-remix\ncd my-remix\nsoyli setup\nsoyli dev'}
            </DocCommand>
            <p>
              Make your changes, check them, then choose either or both paths from that same working
              copy.
            </p>
            <dl className="docs-reference">
              <div>
                <dt>
                  <code>soyli publish</code>
                </dt>
                <dd>Release your own napplet under your identity.</dd>
              </div>
              <div>
                <dt>
                  <code>soyli propose "Describe the change"</code>
                </dt>
                <dd>
                  Send changes upstream with a playable preview. Requires a Git-backed source.
                </dd>
              </div>
            </dl>
            <p>
              Save a <code>soyli checkpoint "Describe the change"</code> before either action.
              Proposals preserve Git ancestry and use Nostr Git events, so ordinary Git/ngit tools
              can inspect the work. Run propose again after a new checkpoint to update the same
              proposal.
            </p>
            <h3>Review someone’s contribution</h3>
            <DocCommand label="Open the proposal inbox">{'soyli review'}</DocCommand>
            <p>
              Run this in your project. The local review app lists proposals, lets you play the
              original and proposed versions, inspect the diff, discuss changes and merge locally.
              Opening a supplied preview does not run its source build.
            </p>
            <p>
              Merging and releasing are separate steps. <code>soyli push</code> shares Git state;{' '}
              <code>soyli publish</code> releases the updated napplet. The website’s Proposed
              changes section also lets people play and discuss a proposal.{' '}
              <a href="https://github.com/soytec/napplet-soy/blob/main/docs/COLLABORATION.md">
                Full collaboration reference
              </a>
              .
            </p>
          </section>
          <section id="backend" aria-labelledby="docs-backend">
            <span className="eyebrow">07 / PLAY TOGETHER</span>
            <h2 id="docs-backend">Shared scores and peer sessions.</h2>
            <p>
              soyLI includes guidance and a shared host for CVM scoreboards, matchmaking and
              NAP-WEBRTC peer connections. Your napplet supplies the game rules and synchronization;
              the host handles signaling and transport.
            </p>
            <DocCommand label="Set up backend support">
              {'soyli backend init\nsoyli backend status'}
            </DocCommand>
            <p>
              Read the generated <code>docs/napplet-backend.md</code> with your coding agent.
              Declare scoreboards and required capabilities, then use <code>soyli dev</code> for
              isolated local backend data. Preview scores do not go to the public board.
            </p>
            <p>
              This does not deploy arbitrary server code. It provides the shared service contract
              described in the{' '}
              <a href="https://github.com/soytec/napplet-soy/blob/main/docs/BACKEND-CREATOR.md">
                backend guide
              </a>
              , including multiplayer test scenarios. Test guest responsiveness as well as
              connection success.
            </p>
          </section>
          <section id="controllers" aria-labelledby="docs-controllers">
            <span className="eyebrow">08 / PLUG IN & PLAY</span>
            <h2 id="docs-controllers">Bring your controller.</h2>
            <p>
              soyLI 0.16.0 adds a Controller tester to the workshop. Pair a USB or Bluetooth
              controller, open the tester, click inside it and press a controller button. Inspect
              buttons and sticks, adjust dead zones and try a mapping in the napplet sandbox.
            </p>
            <p>
              Ask your agent to add controller support using{' '}
              <code>docs/napplet-controllers.md</code> and the bundled input helper. Existing
              projects receive them through <code>soyli skills update</code>. Your game connects the
              controls to its actions and keeps keyboard and touch alternatives. No account or
              backend is needed for input.
            </p>
            <p>
              Check your intended controllers and browsers before sharing. See the{' '}
              <a href="https://github.com/soytec/napplet-soy/blob/main/docs/CONTROLLERS.md">
                controller guide
              </a>{' '}
              for mappings and supported behavior.
            </p>
          </section>
          <section id="lifecycle" aria-labelledby="docs-lifecycle">
            <h2 id="docs-lifecycle">Your publication, your choice.</h2>
            <p>
              Use <Link to="/manage">Your napplets</Link> in the identity menu, or Manage
              publication on a napplet you authored. Unpublish keeps the files so you can republish
              later at the same address. Save the recovery record before clearing browser data.
            </p>
            <DocCommand label="Manage a published project">
              {'soyli unpublish\nsoyli republish\nsoyli delete\nsoyli lifecycle'}
            </DocCommand>
            <p>
              Commands show the inventory and ask for confirmation. Deletion removes selected hosted
              uploads and requests Git removal; each service has its own live result and retry
              state. Local files and keys stay on your device.
            </p>
            <p>
              Shared uploads may be retained. Soy’s Git server keeps a recovery archive for 90 days.
              Copies, forks and independent mirrors cannot be recalled. Republish creates a fresh
              listing; old pinned release links stay unpublished.
            </p>
          </section>
          <section id="help" aria-labelledby="docs-help">
            <span className="eyebrow">09 / PICK UP WHERE YOU LEFT OFF</span>
            <h2 id="docs-help">Update, diagnose, carry on.</h2>
            <DocCommand label="Update soyLI">{'soyli update'}</DocCommand>
            <p>
              This installs the latest stable GitHub release without creating a project. If your CLI
              does not have update yet, use the installer from the{' '}
              <a href="https://github.com/soytec/napplet-soy/releases/latest">
                latest release
              </a>{' '}
              once. Restart running previews. Then run <code>soyli skills update</code> in an
              existing project to refresh its bundled guidance. Edited guidance is preserved and
              conflicts are reported; source and dependencies are not automatically migrated. Doctor
              also checks for a newer release; unavailable network checks do not hide local
              diagnostics.
            </p>
            <DocCommand label="Check your setup">
              {'soyli --version\nsoyli doctor\nsoyli account check\nsoyli --help'}
            </DocCommand>
            <dl className="docs-reference">
              <div>
                <dt>Publication interrupted?</dt>
                <dd>
                  Use <code>soyli status --refresh</code>, then <code>soyli publish --resume</code>{' '}
                  to finish the saved release. Resume uploads its frozen bytes, not later edits.
                </dd>
              </div>
              <div>
                <dt>Keychain unavailable?</dt>
                <dd>
                  New remote signer sessions need no Keychain or desktop keyring. For existing
                  remote sessions, use <code>soyli account storage file</code> while the old vault
                  is accessible. Local private keys require an unlocked OS credential store; Linux
                  needs a running Secret Service keyring. The explicit development file fallback is
                  documented in the identity guide.
                </dd>
              </div>
              <div>
                <dt>Pausing a project?</dt>
                <dd>
                  Save a checkpoint and keep the whole folder, including <code>.git</code> and the
                  ignored <code>.napplet-space</code> binding and journals. Next time, run{' '}
                  <code>soyli dev</code> in that folder.
                </dd>
              </div>
              <div>
                <dt>Command missing?</dt>
                <dd>
                  Check the installed version and help, then update. A source checkout can contain
                  features that have not reached the downloadable release yet.
                </dd>
              </div>
            </dl>
            <p>
              For all flags and implementation limits, see the{' '}
              <a href="https://github.com/soytec/napplet-soy/blob/main/docs/CLI.md">
                CLI reference
              </a>
              . For the bigger picture, visit the{' '}
              <Link to="/about" hash="faq">
                About FAQ
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}
