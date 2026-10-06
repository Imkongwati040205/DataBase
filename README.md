# Papertrail Document Manager

Papertrail is a private document workspace with accounts, per-document sharing, comments, and version history. It accepts PDF, PNG, and JPG files up to 5 MB.

Uploaded file contents and app records are stored in PostgreSQL, so this version does not depend on files written to Render's temporary service filesystem.

## Deploy on Render

1. Create a Render PostgreSQL database.
2. Create a **Web Service** from this project repository. Put the database and web service in the same region.
3. Set the build command to `npm install` and the start command to `npm start`.
4. In the Web Service's environment settings, add:
   - `DATABASE_URL` — the database's **Internal Database URL** from Render.
   - `SESSION_SECRET` — a long, random secret (at least 32 random characters).
   - `NODE_ENV` — `production`.
5. Deploy. On first start, the app creates its PostgreSQL tables automatically.

The web server listens on Render's `PORT` and binds to `0.0.0.0`. Optional health check path: `/api/health`.

## Run locally

1. Install Node.js 22.13 or later and PostgreSQL.
2. Create an empty PostgreSQL database and set `DATABASE_URL` to its connection string.
3. Set `SESSION_SECRET` to a local-only random value.
4. In this folder, run `npm install`, then `npm start`.
5. Open `http://localhost:3001`.

## Features

- Create an account, sign in, and sign out.
- Upload and download PDF, PNG, and JPG documents.
- Add a new version while keeping every older version downloadable.
- Share a document with an existing account as a viewer or editor.
- Leave comments on documents shared with you.
- Only the document owner can change sharing or delete the document.
- Editors can upload versions; viewers can read and download.

## Important data note

This package does not include your old SQLite database or uploaded files. It creates a new PostgreSQL schema on the first start. Existing SQLite records are not migrated automatically. File bytes are stored in PostgreSQL as `BYTEA`, capped at 5 MB per upload; for a much larger library, move binary files to object storage and keep metadata in PostgreSQL.

## API overview

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/documents`, `POST /api/documents`, `DELETE /api/documents/:id`
- `GET /api/documents/:id/download`
- `GET /api/documents/:id/versions`, `POST /api/documents/:id/versions`
- `GET/POST /api/documents/:id/collaborators`
- `GET/POST /api/documents/:id/comments`
