# Biome and Fallow Tooling

Herakles uses Biome for formatting and linting, and Fallow as a CI pull-request quality gate. Biome handles local code style and fast static checks, while Fallow provides quality evidence such as risk, duplication, complexity, dead code, and architecture findings.

The local `quality` script uses Fallow's new-only gate for fast changed-code feedback. GitHub Actions is the CI provider and runs Fallow audit against an explicit base ref so pull requests, pushes to `main`, and manual workflow dispatches do not depend on detached-checkout base detection. Fallow audit is the changed-file quality gate; the separate Fallow health step is the whole-repo advisory report. Herakles does not define a package-level `ci` script; full workflow validation belongs to GitHub Actions.
