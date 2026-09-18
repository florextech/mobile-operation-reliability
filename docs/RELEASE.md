# Release workflow

The repository contains a manual `release` GitHub Actions workflow. It does not
publish on pushes or pull requests.

1. Finish API, compatibility and retention decisions.
2. Set publishable package versions and remove `private: true` only in the
   final packaging change.
3. Run the workflow with `publish=false` to execute the complete quality gate.
4. Review the generated package contents and changelog.
5. Re-run it with `publish=true`, an npm dist-tag and `NPM_TOKEN` configured as
   a repository secret. The workflow publishes only after the gate passes, then
   creates the matching GitHub release.

The workflow rejects a publication when packages remain private or their
versions do not match the release tag. This repository does not publish from a
local developer machine as part of its standard process.
