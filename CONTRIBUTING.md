# Contributing

Use Node 24 and pnpm 10.11.0. Keep the Core free from runtime imports and preserve the distinction between `FAILED` and `UNKNOWN`.

Before opening a pull request, run `pnpm quality:gate`. Every reliability defect needs a deterministic regression test. Do not add a status or transition without an ADR and an update to the state-machine tests.
