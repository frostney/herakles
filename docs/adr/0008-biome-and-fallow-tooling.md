# Biome and Fallow Tooling

Herakles uses Biome for formatting and linting, and Fallow as a CI pull-request quality gate. Biome handles local code style and fast static checks, while Fallow provides quality evidence such as risk, duplication, complexity, dead code, and architecture findings.

The local `quality` script uses Fallow's new-only gate for fast changed-code feedback. GitHub Actions is the CI provider and runs a full Fallow audit so pull requests, pushes to `main`, and manual workflow dispatches are checked against the whole codebase, not only the changed-file slice. Herakles does not define a package-level `ci` script; full workflow validation belongs to GitHub Actions.
