# Papertrail Document Manager

Express and SQLite document manager. It accepts PDF, PNG, and JPG files up to 5 MB.

## Run locally

1. Install Node.js 22.13 or later.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3001`.

## Deploy on Render

Create a **Web Service** from the project repository.

- Build command: `npm install`
- Start command: `npm start`
- Health check path (optional): `/api/health`

The server listens on Render's `PORT` and binds to `0.0.0.0` automatically.

## Keep uploaded files between restarts

Render's default filesystem is temporary. To preserve uploaded files and the SQLite database, attach a persistent disk to the Web Service, set its mount path to `/var/data`, and add this environment variable:

`DATA_DIR=/var/data`

The app stores both `documents.db` and the `uploads` folder under `DATA_DIR`. The service needs a plan that supports a persistent disk. Without a disk, uploads may disappear when Render restarts or redeploys the service.

## API

- `GET /api/health`
- `GET /api/documents`
- `POST /api/documents` with multipart field `file`
- `GET /api/documents/:id/download`
- `DELETE /api/documents/:id`
