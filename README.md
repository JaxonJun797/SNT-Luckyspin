# SNT Lucky Spin API

Secure Express and MongoDB API for the SNT Lucky Spin frontend. Prize selection happens on the server, each normalized username is unique, and every admin route requires a bearer token.

## Local setup

```bash
npm ci
copy .env.example .env
npm start
```

Set these environment variables:

- `MONGODB_URI`: MongoDB connection string.
- `ADMIN_TOKEN`: long random secret used to access the admin page.
- `CORS_ORIGINS`: comma-separated browser origins, without paths or trailing slashes.
- `PORT`: optional; defaults to `3001`.

Generate an admin token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Checks

```bash
npm test
npm run check
```

## Render deployment

This repository includes `render.yaml`. In Render, create a Blueprint from this repository, set `MONGODB_URI`, and copy the generated `ADMIN_TOKEN` to a password manager. After the service deploys, confirm `/api/health` returns a connected database.

Before resetting production data, use the admin page to export JSON. The reset endpoint deletes spin records only; prize configuration remains intact.

## Security migration

Earlier repository history included `.env`. Remove that MongoDB credential from Atlas and create a new database user before production deployment. Removing `.env` from the latest commit does not erase it from Git history.
