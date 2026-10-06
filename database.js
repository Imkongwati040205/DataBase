const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to your PostgreSQL connection string.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      file_data BYTEA NOT NULL,
      uploaded_by BIGINT NOT NULL REFERENCES users(id),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS document_collaborators (
      document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      granted_by BIGINT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(document_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS document_comments (
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS document_versions_document_idx
      ON document_versions(document_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS document_comments_document_idx
      ON document_comments(document_id, created_at);
  `);
}

module.exports = { pool, initializeDatabase };
