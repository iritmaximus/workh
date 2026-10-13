# WorkH — working hours tracker

Log your daily hours, see how much you are over/under your weekly target,
and keep a running balance of extra/minus hours.

- Enter each day as a **total** (`7.15`, `7:15`, `7h15` = 7 h 15 min; `7.5` = 7 h 30 min; 0–24 h) — the default — or as
  **start–end + break**, or mark it **off** (vacation, sick, holiday → no target).
- Full-time target defaults to **36 h 15 min/week** (7:15 per weekday).
- **Workload periods** (Settings) scale the target from a given date, e.g. 50% or 25%.
- Anyone can **create an account** and **delete it** again under _Account_. Each
  account sees only its own hours.
- Several tabs or devices can be open at once: a save never overwrites newer changes
  made elsewhere — edits are merged day by day.

## Project layout

| Path        |                                     |
| ----------- | ----------------------------------- |
| `frontend/` | React app (Vite)                    |
| `backend/`  | Express API, accounts, file storage |
| `shared/`   | Types used by both                  |
| `tests/`    | Unit and integration tests (Vitest) |
| `e2e/`      | End-to-end tests (Playwright)       |

## Configuration

| Variable            | Default  |                                                                                            |
| ------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `PORT`              | `3001`   |                                                                                            |
| `DATA_DIR`          | `./data` | `users.json` + `users/<id>.json`                                                           |
| `SESSION_SECRET`    | random   | Signs login cookies; without it everyone is logged out on restart. `npm run -s gen-secret` |
| `REGISTRATION_CODE` | —        | If set, sign-up requires this invite code                                                  |
| `LOG_LEVEL`         | `info`   | `debug`, `info`, `warn` or `error`; lines below this level are not logged. Format: logfmt  |

Everything else is fixed in `backend/config.ts`: at most 100 accounts, 30-day sessions.
The app does no rate limiting of its own; that is left to the ingress (Traefik).

Session cookies are always `Secure`; browsers accept that on `http://localhost`, but
anywhere else the app must be served over HTTPS.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5173 (Vite + API on :3001) — create an account there
```

`npm run dev` loads `.env` if present (e.g. `npm run -s gen-secret > .env` to stay
logged in across restarts). If you used the single-user version before, the first
account created takes over the hours in `data.json`.

## Checks

```sh
npm run lint           # oxlint
npm run format:check   # oxfmt (npm run format to fix)
npm run typecheck
npm test               # unit + API integration tests
npx playwright install firefox    # once
npm run test:e2e       # builds, starts two test servers, runs Playwright
```

## CI/CD

`.github/workflows/ci.yml` runs lint, format, type, unit and e2e checks on every push and
pull request. When they pass it builds the Docker image; pushes to `main` and `v*` tags
also publish it to `registry.pumppi.dev/workh` (tags: `latest`, branch, version, commit SHA).

Pushing needs the registry login in the `REGISTRY_USER` and `REGISTRY_PASSWORD` repository secrets.

## Docker

```sh
docker build -t workh .      # also runs the unit tests
npm run -s gen-secret > .env.docker
docker run -p 3001:3001 --env-file .env.docker -v workh-data:/app/data workh   # http://localhost:3001
```

## Kubernetes

Manifests are in `workh/` of the [k8s-pumppi](https://github.com/iritmaximus/k8s-pumppi/tree/main/workh) repo: Deployment (1 replica,
PVC-backed), Service, and a Traefik Ingress at `workh.pumppi.dev` with the shared fail2ban
middleware. Argo CD deploys them, and argocd-image-updater rolls out new `:latest` pushes.

1. Create the sealed secret (session secret, plus an optional invite code):
   ```sh
   npm run -s gen-secret > .env.secret
   echo "REGISTRATION_CODE=<invite code>" >> .env.secret   # optional
   kubectl create secret generic workh-secrets -n default \
       --from-env-file=.env.secret --dry-run=client -o yaml \
     | kubeseal --format yaml > ../k8s-pumppi/workh/sealed-secret.yaml
   rm .env.secret
   ```
2. Commit and push k8s-pumppi; Argo CD applies it.
