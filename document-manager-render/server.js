const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");
const db = require("./database");

const app = express();
const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : __dirname;
const uploadDirectory = path.join(dataDirectory, "uploads");
const publicDirectory = path.join(__dirname, "public");
const maxFileSize = 5 * 1024 * 1024;

fs.mkdirSync(uploadDirectory, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(publicDirectory));

const allowedTypes = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, crypto.randomUUID() + extension);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const expectedType = allowedTypes[extension];

    if (!expectedType || file.mimetype !== expectedType) {
      return callback(new Error("Only PDF, PNG, and JPG files are allowed."));
    }

    callback(null, true);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "Document manager is running." });
});

app.get("/api/documents", (_req, res, next) => {
  try {
    const documents = db.prepare(`
      SELECT id, original_name, size, uploaded_at
      FROM documents
      ORDER BY id DESC
    `).all();

    res.json(documents);
  } catch (error) {
    next(error);
  }
});

app.post("/api/documents", (req, res, next) => {
  upload.single("file")(req, res, (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ error: uploadError.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Choose a file to upload." });
    }

    try {
      const result = db.prepare(`
        INSERT INTO documents (original_name, stored_name, size)
        VALUES (?, ?, ?)
      `).run(req.file.originalname, req.file.filename, req.file.size);

      return res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Could not remove an incomplete upload:", cleanupError);
      }

      return next(error);
    }
  });
});

app.get("/api/documents/:id/download", (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid document ID." });
  }

  try {
    const document = db.prepare(`
      SELECT original_name, stored_name
      FROM documents
      WHERE id = ?
    `).get(id);

    if (!document) {
      return res.status(404).json({ error: "Document not found." });
    }

    const filePath = path.join(uploadDirectory, document.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File is missing from storage." });
    }

    return res.download(filePath, document.original_name);
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/documents/:id", (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid document ID." });
  }

  try {
    const document = db.prepare(
      "SELECT stored_name FROM documents WHERE id = ?"
    ).get(id);

    if (!document) {
      return res.status(404).json({ error: "Document not found." });
    }

    const filePath = path.join(uploadDirectory, document.stored_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    return res.json({ message: "Document deleted." });
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
  res.status(500).json({ error: "The server could not complete the request." });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log("Document manager listening on port " + port);
});
