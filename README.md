<p align="center">
  <img src="public/logo.png" alt="Mailhub logo" width="120" />
</p>

# Mailhub frontend

React 18, TypeScript, Vite, and Tailwind UI for Mailhub.
[API and worker repository](https://github.com/private-mailhub/backend-api).

## Development

Use Node 24.14.1 and its bundled npm (the CI validation runtime).

```bash
npm ci --engine-strict
cp .env.example .env
npm start
```

Open http://localhost:3000. Configure `VITE_API_URL` to the API origin, for example
`http://localhost:8080`, without a trailing slash or `/api`. An empty value falls back to
localhost; it does not select same-origin requests. The existing Vite `/api` proxy remains,
but absolute API URLs bypass it.

Production builds must use an HTTPS API origin. The browser does not receive or use backend
encryption keys: authentication and username-change payloads are sent as JSON over HTTPS, while
encryption at rest is owned by the API. Never pass JWT, AWS, Mailgun, backend encryption, or OAuth
secrets to this build. Unprefixed APP_NAME/APP_DOMAIN retain existing fallback behavior; the Vite
environment prefix is unchanged.

## Validation

```bash
npm run lint
npm run typecheck
npm run build:prod
bash test/production-build.sh
bash test/deploy-release.sh
```

`npm run build` performs a pure Vite build. The shell checks cover production asset key exposure
and immutable release packaging. Formatting and lint fixes are explicit commands. There is no
frontend test runner; no new test dependency is required.

## API compatibility

The client retains `/api/auth`, `/api/users`, `/api/relay-emails`, and `/api/admin`,
`{ result, data }` responses, accessToken in localStorage, and credentialed refresh requests.
Email verification and login use `{ username }` and `{ username, code }`; username changes use
`{ newUsername }` followed by `{ code }` for verification. Refresh cookie behavior and OAuth
callback paths `/login/oauth/{github|google}/callback` are unchanged.

## Deployment and rollback

See [deployment](docs/deployment.md) and [extraction record](docs/repository-split.md).
Frontend deployment publishes static files only; it never invokes PM2. Backend owns the
shared Nginx configuration. Validate old/new client and API combinations, SPA deep links,
existing sessions, OAuth flows, relay management, and old-tab assets before production activation.

## License

[GNU Affero General Public License v3.0](LICENSE). Original authorship is retained in Git history.
