# Owlbear extensions for the Cosmere RPG

Custom [Owlbear Rodeo](https://www.owlbear.rodeo) extensions for running the Cosmere RPG. TypeScript, Vite, Owlbear SDK 3.1. These extensions are built with Claude.

| Extension | What it does |
| --- | --- |
| `initiative_tracker` | Cosmere RPG Combat Turn Tracker. Handles the four bands of action (fast PC, fast NPC, slow PC, slow NPC), and has basic state tracking (action arrows, Done marks, Down and Dead). |
| `endeavor_tracker` | Cosmere RPG endeavor tracker. Success, failure and clock tracks for Discovery, Exploration, Mission, Pursuit and Legacy endeavors, with an objectives checklist, GM notes, per-track hiding from players and a change log with undo. |

The deployed site has a landing page with each manifest URL and a player and GM guide for each extension:
https://bktheperson.github.io/owlbear_extensions_cosmererpg/

## Request features and report bugs!

Feel free to report any bugs or request features using issues.

## Add it to Owlbear

1. In Owlbear, open your profile menu, choose **Extensions**, then **Add Extension**.
2. Paste the manifest URL of the extension you want:
   - Initiative: `https://bktheperson.github.io/owlbear_extensions_cosmererpg/initiative/manifest.json`
   - Endeavors: `https://bktheperson.github.io/owlbear_extensions_cosmererpg/endeavor/manifest.json`
3. Turn the extension on in your room.

A push to `main` that changes an extension redeploys that extension only, and it updates for everyone who has it installed. Reload Owlbear to pick up a new version.

## Develop

Requires Node 22.18 or newer (the tests run TypeScript directly).

```sh
npm install
npm run dev
```

That runs the initiative tracker. `npm run dev:endeavor` runs the endeavor tracker on port 5174. Then add `http://localhost:5173/manifest.json` (or 5174) as another extension in Owlbear. You can have the local and deployed copies installed together, but turn on only one per room.

| Command | What it does |
| --- | --- |
| `npm run dev` | Initiative tracker dev server on port 5173 with CORS enabled and a generated manifest |
| `npm run dev:endeavor` | The same for the endeavor tracker, on port 5174 |
| `npm run typecheck` | Strict TypeScript check of both extensions |
| `npm test` | Unit tests for the rules logic of both |
| `npm run build` | Typecheck, then build each to `extensions/<name>/dist` |

Add `-w initiative_tracker` or `-w endeavor_tracker` to run a command for one extension.

The endeavor tracker also opens outside Owlbear: with its dev server running, go to `http://localhost:5174/popover.html`. It runs against a stand-in room kept in that tab's local storage. Add `?role=player` for the player view.

## Layout

```
site/
  index.html          landing page at the site root (static)
  site.css            styles for the landing page and the guides
extensions/initiative_tracker/
  popover.html        the extension popover (processed by Vite)
  manifest.ts         builds manifest.json from the deploy path
  vite.config.ts      serves and emits the manifest, builds popover.html
  public/
    guide.html        player and GM guide (static, uses ../site.css)
    icon.svg          toolbar icon
  src/
    state.ts          pure rules logic (no Owlbear imports)
    state.test.ts     tests for state.ts
    main.ts           Owlbear wiring and rendering
    style.css         popover styles
extensions/endeavor_tracker/
  (same files as above, plus)
  src/
    host.ts           the Owlbear calls the popover uses, and the dev stand-in
```

The initiative tracker keeps its state in Owlbear scene metadata, one key per combatant plus one for the round and band. The endeavor tracker uses room metadata, because endeavors span scenes: one key per endeavor, one for the pinned endeavor and one for the change log. Room metadata is capped at 16 kB shared by every extension, so its records are kept small.

Owlbear does not enforce permissions on metadata, and every client can read all of it. So GM-only controls are hidden in the interface rather than locked, and the endeavor tracker's hidden tracks and GM notes are hidden in the interface only.

## Deployment

The site is served from the `gh-pages` branch. Each part has its own folder there and its own workflow, so a push to `main` redeploys only what it changed:

| Workflow | Runs when these change | Publishes to |
| --- | --- | --- |
| `deploy-initiative.yml` | `extensions/initiative_tracker/`, the root `package.json` or lockfile | `/<repo>/initiative/` |
| `deploy-endeavor.yml` | `extensions/endeavor_tracker/`, the root `package.json` or lockfile | `/<repo>/endeavor/` |
| `deploy-site.yml` | `site/` | `/<repo>/` (top-level files only) |

Each extension's workflow runs typecheck, tests and build for that extension only, and a failure blocks its deploy. It sets `BASE_PATH` to the extension's folder (such as `/<repo>/initiative/`) so the manifest paths are correct. Owlbear rejects relative paths in a manifest, which is why the manifest is generated. All the workflows publish with `.github/scripts/publish.sh`, which replaces one folder on `gh-pages` and leaves the rest alone. Any of them can also be run by hand from the Actions tab.

One-time setup: in the repo, go to Settings, Pages, set the source to **Deploy from a branch**, and pick `gh-pages` and `/ (root)`. The branch is created by the first deploy. A free account needs a public repo.

To add an extension, give it a folder under `extensions/`, copy `deploy-initiative.yml` with the new paths and folder name, add it to the root `package.json` scripts, and link it from `site/index.html`.

To change the landing page, edit `site/index.html`. The guide links to `../site.css` and back to the site root, so on the local dev server it shows unstyled.

### Changing stored data

Both trackers keep their state in Owlbear metadata, and an open popover keeps running the code it loaded. So:

- Only add optional fields. Never rename or retype a stored field.
- Read stored data tolerantly: a missing or malformed field falls back to a default. Write unknown fields back untouched, so older code does not erase what a newer version added.
- A push to `main` deploys at once, but open popovers keep the old code. Do not push a storage change during a game, and reload Owlbear after a deploy.

## Known issues

2 moderate vulnerabilities reported in the Owlbear SDK dependency, with no fix available as of October 2026.

## About me
I'm a DM and a player, and I'm looking for ways to burn my extra tokens that are functional and beneficial. My coding background is from academic research, so you would probably prefer this vibe-coded stuff over what I pump out by hand!