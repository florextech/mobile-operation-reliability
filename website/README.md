# Documentation site

This public documentation site is built with Docusaurus.

```sh
pnpm --filter @florexlabs/docs start
pnpm --filter @florexlabs/docs build
```

GitHub Actions builds pull requests and deploys the static `website/build`
artifact after a push to `main`. In the GitHub repository settings, set Pages
to use **GitHub Actions** as its source. The workflow derives the owner and
repository name at runtime, so it works for a fork without hard-coded URLs.
