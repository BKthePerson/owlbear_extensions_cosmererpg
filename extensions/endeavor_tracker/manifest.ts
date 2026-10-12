// The Owlbear manifest, built in code so its paths follow the deploy location.
// `base` is "/" for local dev and "/<repo>/endeavor/" for Pages. Owlbear rejects
// relative paths in a manifest, so the prefix has to be written in.

export function buildManifest(base: string) {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return {
    name: "Cosmere endeavor tracker",
    version: "0.1.0",
    manifest_version: 1,
    description: "Success, failure and clock tracks for Cosmere RPG endeavors",
    author: "Brandon Klein",
    action: {
      title: "Endeavors",
      icon: `${prefix}icon.svg`,
      popover: `${prefix}popover.html`,
      width: 420,
      height: 620,
    },
  };
}
