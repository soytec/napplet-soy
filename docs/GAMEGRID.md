# Gamegrid

`/gg` is the controller-oriented view of the existing shell, intended for a PC or
Steam Deck browser, including a TV connected to that computer. It shares the
catalog, account, wallet, verified player and permissions with the rest of the site.
Browsing and playing do not require an account. Gamegrid is a beta: automated
controller checks cover the shell flow, while physical-controller and Steam Deck
hardware acceptance remains outstanding.

The grid fills the viewport with edge-to-edge previews, square corners and no
gutters or outer padding. A compact dark glass overlay holds collections, search,
wallet, account and exit controls. Controls and dialogs use translucent surfaces
with backdrop blur, preserving visible previews underneath. Titles and play hints
appear on focus or hover; there is no sidebar, page heading, card frame or
persistent footer. Discover is a vertically scrolling wall of Featured, Most liked,
Most zapped, Most commented and New arrivals. Section names sit on small glass
overlays. Featured and discussion sections use a larger lead tile beside six
smaller previews; the likes section mirrors that arrangement, and zap/new sections
use even rows. Narrow screens collapse to two columns. Empty rankings are labeled
instead of substituting unrelated games.

## Browsing and controls

- Discover, Featured, Most liked, Most zapped, Most commented, New, All games and
  Continue use the existing catalog. `#game` is
  creator-supplied categorization, not proof that a game supports a controller.
- Continue is device-local play history, not a cloud save. The running napplet's
  storage follows the normal shell rules. Returning to the grid restores the tile.
- D-pad or left stick moves focus; the bottom face button (A on Xbox) selects;
  the right face button (B on Xbox) goes back one level. Up from the grid's first
  row reaches the toolbar; Down returns to the last tile. Horizontal movement
  stays within the grid or toolbar. Arrow keys and pointer remain usable.
- The right stick scrolls vertically at a speed proportional to its deflection.
  It scrolls the active dialog when one is open and the catalog otherwise. Focus
  moves to a visible tile if scrolling takes the selected tile offscreen. Neutral
  input is required after a scope change; the stick never scrolls behind a game.
- Either Select/View or Start/Menu (standard button 8 or 9) opens the shell menu
  from browsing or gameplay. Pressing either again closes the Gamegrid menu;
  other approval and payment dialogs keep priority. The menu includes collections,
  search, wallet, account and exit, with resume/restart actions during play.
  Resume preserves the same player. The controller must return to neutral before
  focus returns to the game. F1 also opens the menu when keyboard focus is in the
  shell; an opaque game's keyboard events do not bubble to the parent.
- LB/RB cycles collections and Y opens search while browsing. These shortcuts
  do not act behind dialogs or during gameplay. B cancels a choice or keyboard,
  returns from wallet details/sign-in forms, then closes the enclosing dialog.
  On the grid it clears search, returns to Discover, then opens the menu.
- Search and editable shell fields offer an on-screen keyboard. A on a select
  opens a choice dialog: D-pad moves, A confirms, B cancels without changing it.
  Simply focusing a select does not change its value or trap horizontal movement.
  Range controls support left/right. The keyboard includes printable ASCII symbols; other
  languages use the device's keyboard.
- New dialogs, reconnects and focus changes require neutral input before another
  controller action. A held A must never approve a newly opened permission prompt.

The page already fills the viewport. The menu's browser fullscreen control toggles
between Enter and Exit and tracks native Escape/fullscreen changes. It is optional and may require
a pointer or keyboard gesture; a synthetic gamepad click cannot bypass browser
activation policy. Accounts and wallet tools use trusted shell dialogs above the
player, including browser fullscreen. Their existing confirmation and recovery
rules apply; Gamegrid adds no payment polling or implicit approvals.

## Input ownership and limits

During gameplay, Gamegrid reserves Start/Select for the shell menu. It does not
use the game's ordinary A/B/D-pad input to navigate the background grid. Its menu
moves focus out of the game, but it cannot universally pause a napplet or consume
native Gamepad API readings. Games using the supplied focus-aware helper become
neutral on blur; a game reading raw native input may continue while a menu is open.
No injected gamepad shim, new NAP grant, sandbox exception or cross-frame access is
introduced here. Unknown controller mappings are reported rather than guessed.

Visible tiles automatically play available muted, looping clips, subject to
reduced-motion/data-saving preferences. Offscreen clips and clips in a hidden tab
stop; opening a game or Gamegrid menu stops grid previews. A shared preview group
allows the visible clips to coexist without interrupting explicit media or games.
Other shell galleries keep their existing exclusive-preview behavior. Missing
artwork does not exclude a game. Likes/comments reuse the shell's NIP-45 counts;
zap rankings reuse verified receipts. All retain their relay/cache coverage limits
and are not a claim to a global leaderboard.
Unavailable count relays show an explicit retry instead of an indefinite loading
message. After eight seconds, incomplete replies are labeled partial or unavailable;
the reads remain active and late replies still update the ranking. Retry rechecks
relay support and requests fresh counts while preserving results already received.

## Deployment

Serve `/gg` from the same app deployment as the other routes. A branded
`gamegrid.napplet.soy` address can issue a permanent redirect to
`https://napplet.soy/gg`, retaining a query string if desired. It should not host a
second app origin: that would separate browser accounts, keys and wallet storage.
DNS and a TLS-enabled redirect require an explicit deployment; no separate backend,
database, inference service or API is needed for this route.

## Verification

Input unit tests cover spatial movement, repeat, diagonal input, reconnect/focus
boundaries, held confirmation and gameplay handoff. Browser regressions exercise
the actual hook, shell dialogs, on-screen keyboard and an opaque iframe. Synthetic
controllers establish these behaviors, not USB/Bluetooth or Steam Deck acceptance.
The rendered route was also checked in Chromium at 1280 × 800 and 1920 × 1080,
including search, the keyboard, account dialog and playable preview/menu handoff.
Physical controller, Safari/Firefox and smart-TV browser testing remain separate;
native smart-TV browsers are outside the first target.
