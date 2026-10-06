const express = require("express");
const path = require("node:path");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { pool, initializeDatabase } = require("./database");

const app = express();
const PgSessionStore = connectPgSimple(session);
const maxFileSize = 5 * 1024 * 1024;
const allowedTypes = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("Set SESSION_SECRET in your Render environment variables.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(session({
  store: new PgSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || "local-development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = require("node:path").extname(file.originalname).toLowerCase();
    if (!allowedTypes[extension]) {
      return callback(new Error("Only PDF, PNG, and JPG files are allowed."));
    }
    callback(null, true);
  }
});

function requireUser(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  req.user = {
    id: req.session.userId,
    displayName: req.session.displayName,
    email: req.session.email
  };
  next();
}

function publicUser(user) {
  return { id: user.id, displayName: user.display_name, email: user.email };
}

function setLoginSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = String(user.id);
      req.session.displayName = user.display_name;
      req.session.email = user.email;
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

function uploadedFileError(file) {
  if (!file) return "Choose a file to upload.";
  const extension = require("node:path").extname(file.originalname).toLowerCase();
  const bytes = file.buffer;
  let matches = false;

  if (extension === ".pdf") matches = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === ".png") matches = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".jpg" || extension === ".jpeg") {
    matches = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }

  return matches ? null : "The file contents do not match its PDF, PNG, or JPG extension.";
}

async function getAccess(documentId, userId) {
  const result = await pool.query(`
    SELECT d.id, d.owner_id,
      CASE WHEN d.owner_id = $2 THEN 'owner' ELSE c.role END AS role
    FROM documents d
    LEFT JOIN document_collaborators c
      ON c.document_id = d.id AND c.user_id = $2
    WHERE d.id = $1 AND (d.owner_id = $2 OR c.user_id = $2)
  `, [documentId, userId]);
  return result.rows[0] || null;
}

function canEdit(access) {
  return access && (access.role === "owner" || access.role === "editor");
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "Papertrail is running." });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  return res.json({
    user: {
      id: req.session.userId,
      displayName: req.session.displayName,
      email: req.session.email
    }
  });
});

app.post("/api/auth/register", async (req, res, next) => {
  const displayName = String(req.body.displayName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (displayName.length < 2 || displayName.length > 80) {
    return res.status(400).json({ error: "Name must be 2 to 80 characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 8 to 72 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(`
      INSERT INTO users (display_name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, display_name, email
    `, [displayName, email, passwordHash]);
    const user = result.rows[0];
    await setLoginSession(req, user);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    return next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  try {
    const result = await pool.query(`
      SELECT id, display_name, email, password_hash
      FROM users WHERE email = $1
    `, [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    await setLoginSession(req, user);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    return res.json({ message: "Signed out." });
  });
});

app.get("/api/documents", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.original_name, d.owner_id, d.created_at, d.updated_at,
        owner.display_name AS owner_name,
        CASE WHEN d.owner_id = $1 THEN 'owner' ELSE c.role END AS role,
        latest.version_number AS latest_version,
        latest.file_size AS size,
        COUNT(v.id)::int AS version_count
      FROM documents d
      JOIN users owner ON owner.id = d.owner_id
      LEFT JOIN document_collaborators c
        ON c.document_id = d.id AND c.user_id = $1
      LEFT JOIN document_versions latest ON latest.id = (
        SELECT v2.id FROM document_versions v2
        WHERE v2.document_id = d.id
        ORDER BY v2.version_number DESC LIMIT 1
      )
      LEFT JOIN document_versions v ON v.document_id = d.id
      WHERE d.owner_id = $1 OR c.user_id = $1
      GROUP BY d.id, owner.display_name, c.role, latest.version_number, latest.file_size
      ORDER BY d.updated_at DESC
    `, [req.user.id]);
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/documents", requireUser, (req, res, next) => {
  upload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ error: uploadError.code === "LIMIT_FILE_SIZE" ? "Files must be 5 MB or smaller." : uploadError.message });
    }
    const validationError = uploadedFileError(req.file);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const document = await withTransaction(async (client) => {
        const created = await client.query(`
          INSERT INTO documents (owner_id, original_name)
          VALUES ($1, $2) RETURNING id
        `, [req.user.id, req.file.originalname]);
        await client.query(`
          INSERT INTO document_versions
            (document_id, version_number, original_name, mime_type, file_size, file_data, uploaded_by)
          VALUES ($1, 1, $2, $3, $4, $5, $6)
        `, [created.rows[0].id, req.file.originalname, allowedTypes[require("node:path").extname(req.file.originalname).toLowerCase()], req.file.size, req.file.buffer, req.user.id]);
        return created.rows[0];
      });
      return res.status(201).json({ id: document.id, version: 1 });
    } catch (error) {
      return next(error);
    }
  });
});

app.get("/api/documents/:id/versions", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    const result = await pool.query(`
      SELECT v.version_number, v.original_name, v.mime_type, v.file_size,
        v.uploaded_at, u.display_name AS uploaded_by
      FROM document_versions v JOIN users u ON u.id = v.uploaded_by
      WHERE v.document_id = $1
      ORDER BY v.version_number DESC
    `, [req.params.id]);
    return res.json({ role: access.role, versions: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/documents/:id/versions", requireUser, (req, res, next) => {
  upload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ error: uploadError.code === "LIMIT_FILE_SIZE" ? "Files must be 5 MB or smaller." : uploadError.message });
    }
    const validationError = uploadedFileError(req.file);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const version = await withTransaction(async (client) => {
        const access = await getAccess(req.params.id, req.user.id);
        if (!canEdit(access)) {
          const error = new Error(access ? "You have view-only access." : "Document not found.");
          error.status = access ? 403 : 404;
          throw error;
        }
        const numberResult = await client.query(`
          SELECT COALESCE(MAX(version_number), 0)::int + 1 AS next_version
          FROM document_versions WHERE document_id = $1
        `, [req.params.id]);
        const nextVersion = numberResult.rows[0].next_version;
        await client.query(`
          INSERT INTO document_versions
            (document_id, version_number, original_name, mime_type, file_size, file_data, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [req.params.id, nextVersion, req.file.originalname, allowedTypes[require("node:path").extname(req.file.originalname).toLowerCase()], req.file.size, req.file.buffer, req.user.id]);
        await client.query("UPDATE documents SET updated_at = NOW() WHERE id = $1", [req.params.id]);
        return nextVersion;
      });
      return res.status(201).json({ version });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });
});

app.get("/api/documents/:id/download", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    const result = await pool.query(`
      SELECT original_name, mime_type, file_data FROM document_versions
      WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "No file version found." });
    res.type(result.rows[0].mime_type);
    res.attachment(result.rows[0].original_name);
    return res.send(result.rows[0].file_data);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/documents/:id/versions/:versionNumber/download", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    const result = await pool.query(`
      SELECT original_name, mime_type, file_data FROM document_versions
      WHERE document_id = $1 AND version_number = $2
    `, [req.params.id, req.params.versionNumber]);
    if (!result.rows[0]) return res.status(404).json({ error: "Version not found." });
    res.type(result.rows[0].mime_type);
    res.attachment(result.rows[0].original_name);
    return res.send(result.rows[0].file_data);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/documents/:id/collaborators", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    const result = await pool.query(`
      SELECT u.id, u.display_name, u.email, c.role
      FROM document_collaborators c JOIN users u ON u.id = c.user_id
      WHERE c.document_id = $1 ORDER BY u.display_name
    `, [req.params.id]);
    return res.json({ role: access.role, collaborators: result.rows });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/documents/:id/collaborators", requireUser, async (req, res, next) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const role = req.body.role === "editor" ? "editor" : "viewer";
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    if (access.role !== "owner") return res.status(403).json({ error: "Only the owner can manage sharing." });
    const target = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (!target.rows[0]) return res.status(404).json({ error: "That person needs to create an account first." });
    if (String(target.rows[0].id) === String(req.user.id)) return res.status(400).json({ error: "You already own this document." });
    await pool.query(`
      INSERT INTO document_collaborators (document_id, user_id, role, granted_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (document_id, user_id)
      DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, created_at = NOW()
    `, [req.params.id, target.rows[0].id, role, req.user.id]);
    return res.status(201).json({ message: "Collaborator added." });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/documents/:id/collaborators/:userId", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    if (access.role !== "owner") return res.status(403).json({ error: "Only the owner can manage sharing." });
    await pool.query("DELETE FROM document_collaborators WHERE document_id = $1 AND user_id = $2", [req.params.id, req.params.userId]);
    return res.json({ message: "Collaborator removed." });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/documents/:id/comments", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    const result = await pool.query(`
      SELECT c.id, c.body, c.created_at, u.display_name, u.email
      FROM document_comments c JOIN users u ON u.id = c.user_id
      WHERE c.document_id = $1 ORDER BY c.created_at ASC
    `, [req.params.id]);
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/documents/:id/comments", requireUser, async (req, res, next) => {
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 2000) return res.status(400).json({ error: "Comments must be 1 to 2000 characters." });
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    const result = await pool.query(`
      INSERT INTO document_comments (document_id, user_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at
    `, [req.params.id, req.user.id, body]);
    return res.status(201).json({ ...result.rows[0], display_name: req.user.displayName, email: req.user.email });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/documents/:id", requireUser, async (req, res, next) => {
  try {
    const access = await getAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: "Document not found." });
    if (access.role !== "owner") return res.status(403).json({ error: "Only the owner can delete this document." });
    await pool.query("DELETE FROM documents WHERE id = $1", [req.params.id]);
    return res.json({ message: "Document and its version history deleted." });
  } catch (error) {
    return next(error);
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error);
  if (res.headersSent) return;
  const status = Number.isInteger(error.status) ? error.status : 500;
  const message = status < 500 ? error.message : "The server could not complete the request.";
  return res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 3001;
initializeDatabase()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log("Papertrail listening on port " + port);
    });
  })
  .catch((error) => {
    console.error("Could not initialize PostgreSQL:", error);
    process.exit(1);
  });
