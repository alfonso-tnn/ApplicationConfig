# Application Config

Web tool for comparing application configuration between versions and environments:
translations, errors, globals, branding, and backend APIs.

The backend explorer displays main endpoints, API URLs stored in options, URL
parameters, service mappings, and side-by-side differences.

## Saved configurations

Both sources start with `variant=default`. In **Saved configurations**, enter a
name and select **Save** to store both sources (including advanced fields), the
ignored-key filter, and the **Regular expressions** checkbox together.

Choose a saved configuration and select **Load** to restore all its fields.
Loading clears outdated results and cancels any pending comparison; it does not
fetch data until you select **Fetch & compare**. Saving an existing name requires
confirmation, as does deleting a configuration.

Presets are stored in local storage for the current browser and website origin.
They survive reloads but are not shared between browsers, devices, or the local
development site and GitHub Pages. Clearing browser storage removes them. API
responses and results are not saved in presets. Storage failures are reported
without claiming a save succeeded or overwriting unreadable data.

## Local development

Use Node.js 22 and npm.

```powershell
npm ci
npm run dev
```

The local Vite server uses the root path. API responses are fetched directly by the
browser and are not stored in this repository. The destination APIs must allow
cross-origin requests from the website's origin.

## Validation

```powershell
npm run lint
npm test
npm run build
```

## GitHub Pages

Repository: <https://github.com/alfonso-tnn/ApplicationConfig>

Website: <https://alfonso-tnn.github.io/ApplicationConfig/>

In the repository's **Settings > Pages > Build and deployment**, set **Source** to
**GitHub Actions**. GitHub Actions must be enabled, and the `github-pages`
environment must permit deployments from `main`.

The [deployment workflow](.github/workflows/deploy-pages.yml) installs locked
dependencies, lints, tests, builds, and publishes the website on every push to
`main`. Pull requests run validation without publishing. A manual deployment can
also be started from **Actions > Validate and publish GitHub Pages > Run workflow**.

The build uses the Pages base path for asset URLs. `VITE_BASE_PATH` is optional
locally and defaults to `/`. To preview a project-site build:

```powershell
$env:VITE_BASE_PATH = '/ApplicationConfig/'
npm run build
Remove-Item Env:VITE_BASE_PATH
npm run preview
```

Open the preview server at `/ApplicationConfig/`.

## Publishing an update

After making changes, commit and push them to `main`. The workflow checks the
changes before replacing the published website; a failed validation does not
publish a new version. For reviewed changes, use a branch and merge its pull
request into `main`.

```powershell
git add src
git commit -m "Describe the change"
git push origin main
```

Stage any changed configuration or documentation files as well. Check the
repository's **Actions** tab for validation and deployment status.

GitHub Pages is public for this deployment. Do not commit credentials, environment
files, or saved API responses. Hiding a value in the UI does not protect the
underlying API, which must enforce its own access policy.
