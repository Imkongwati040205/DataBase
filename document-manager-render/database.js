const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : __dirname;

fs.mkdirSync(dataDirectory, { recursive: true });

const db = new DatabaseSync(path.join(dataDirectory, "documents.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;
