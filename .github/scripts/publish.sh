#!/usr/bin/env bash
# Publishes one folder to the gh-pages branch and leaves the rest of the branch
# alone, so each extension (and the landing page) deploys on its own.
#
#   publish.sh <source dir> <folder on the site, or "." for the site root>
#
# Needs GITHUB_TOKEN and GITHUB_REPOSITORY, which Actions provides.
# PUBLISH_REMOTE overrides the remote, for trying the script against a local repo.
set -euo pipefail

src="$1"
dest="$2"
remote="${PUBLISH_REMOTE:-https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git}"
out="$(mktemp -d)"

found=0
git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null || found=$?
if [ "$found" -eq 0 ]; then
  git clone --quiet --depth 1 --branch gh-pages "$remote" "$out"
elif [ "$found" -eq 2 ]; then
  # Exit code 2 means the remote answered and has no such branch: first deploy.
  git init --quiet --initial-branch gh-pages "$out"
  git -C "$out" remote add origin "$remote"
else
  echo "Could not reach the remote." >&2
  exit "$found"
fi

if [ "$dest" = "." ]; then
  # Site root: replace only the top-level files, never an extension's folder.
  find "$out" -mindepth 1 -maxdepth 1 -type f -delete
else
  rm -rf "${out:?}/$dest"
  mkdir -p "$out/$dest"
fi
cp -R "$src/." "$out/$dest/"
# Stops GitHub Pages running the files through Jekyll.
touch "$out/.nojekyll"

cd "$out"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add --all
if git diff --cached --quiet; then
  echo "Nothing to publish."
  exit 0
fi
git commit --quiet -m "Publish $dest from ${GITHUB_SHA:-a local run}"

# Another deploy may push first. Its changes are in a different folder, so
# replaying this commit on top of them is safe.
for attempt in 1 2 3; do
  if git push --quiet origin gh-pages; then
    echo "Published $dest."
    exit 0
  fi
  echo "Push rejected (attempt $attempt), picking up the other deploy and retrying."
  git pull --quiet --rebase origin gh-pages
done
echo "Could not push to gh-pages." >&2
exit 1
