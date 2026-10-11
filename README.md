# Owlbear extensions for the Cosmere RPG

Custom [Owlbear Rodeo](https://www.owlbear.rodeo) extensions for running the Cosmere RPG. TypeScript, Vite, Owlbear SDK 3.1. These extensions are built with Claude.

| Extension | What it does |
| --- | --- |
| `initiative_tracker` | Cosmere RPG Combat Turn Tracker. Handles the four bands of action (fast PC, fast NPC, slow PC, slow NPC), and has basic state tracking (action arrows, Done marks, Down and Dead). |

The deployed site has a landing page with the manifest URL and a player and GM guide:
https://bktheperson.github.io/owlbear_extensions_cosmererpg/

## Request features and report bugs!

Feel free to report any bugs or request features using issues.

## Add it to Owlbear

1. In Owlbear, open your profile menu, choose **Extensions**, then **Add Extension**.
2. Paste the manifest URL: `https://bktheperson.github.io/owlbear_extensions_cosmererpg/manifest.json`
3. Turn the extension on in your room.

Every push to `main` redeploys the site, so the extension updates for everyone. Reload Owlbear to pick up a new version.

## Develop

Requires Node 22.18 or newer (the tests run TypeScript directly).

```sh
npm install
npm run dev
```

Then add `http://localhost:5173/manifest.json` as a second extension in Owlbear. You can have the local and deployed copies installed together, but turn on only one per room.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173 with CORS enabled and a generated manifest |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Unit tests for the rules logic |
| `npm run build` | Typecheck, then build to `extensions/initiative_tracker/dist` |

## Layout

```
extensions/initiative_tracker/
  popover.html        the extension popover (processed by Vite)
  manifest.ts         builds manifest.json from the deploy path
  vite.config.ts      serves and emits the manifest, builds popover.html
  public/
    index.html        landing page at the site root (static)
    guide.html        player and GM guide (static)
    site.css          styles for those two pages
    icon.svg          toolbar icon
  src/
    state.ts          pure rules logic (no Owlbear imports)
    state.test.ts     tests for state.ts
    main.ts           Owlbear wiring and rendering
    style.css         popover styles
```

State lives in Owlbear scene metadata, one key per combatant plus one for the round and band. Owlbear does not enforce permissions on metadata, so GM-only controls are hidden in the interface rather than locked.

## Deployment

`.github/workflows/deploy.yml` runs typecheck, tests and build on every push to `main`, then publishes to GitHub Pages. It sets `BASE_PATH` to `/<repo>/` so the manifest paths are correct for a project site. Owlbear rejects relative paths in a manifest, which is why the manifest is generated.

One-time setup: in the repo, go to Settings, Pages, and set the source to **GitHub Actions**. A free account needs a public repo.

To change the landing page, edit `extensions/initiative_tracker/public/index.html`. The popover lives at `popover.html`, so the site root is free for any page.

## Known issues

2 moderate vulnerabilities reported in the Owlbear SDK dependency, with no fix available as of October 2026.

## About me
I'm a DM and a player, and I'm looking for ways to burn my extra tokens that are functional and beneficial. My coding background is from academic research, so you would probably prefer this vibe-coded stuff over what I pump out by hand!