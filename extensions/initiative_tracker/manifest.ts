// The Owlbear manifest, built in code so its paths follow the deploy location.
//
// Owlbear rejects relative paths in a manifest, and root-absolute paths resolve
// against the site origin. On GitHub Pages a project site lives under
// /<repo>/, so the paths must include that prefix. `base` is that prefix
// ("/" for local dev, "/<repo>/" for Pages).

export function buildManifest(base: string) {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return {
    name: "Cosmere initiative tracker",
    version: "0.1.0",
    manifest_version: 1,
    description: "Fast and slow turn tracker for the Cosmere RPG",
    author: "Brandon Klein",
    action: {
      title: "Initiative",
      icon: `${prefix}icon.svg`,
      popover: `${prefix}index.html`,
      width: 420,
      height: 620,
    },
  };
}
