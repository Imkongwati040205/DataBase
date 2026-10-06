const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file");
const fileLabel = document.querySelector("#file-label");
const dropzone = document.querySelector("#dropzone");
const uploadButton = document.querySelector("#upload-button");
const statusBox = document.querySelector("#status");
const list = document.querySelector("#document-list");
const emptyState = document.querySelector("#empty-state");
const emptyTitle = document.querySelector("#empty-title");
const emptyCopy = document.querySelector("#empty-copy");
const subtitle = document.querySelector("#library-subtitle");
const searchInput = document.querySelector("#search-input");

let documents = [];
let statusTimer;

function setStatus(message, kind = "info", timeout = 5000) {
  window.clearTimeout(statusTimer);
  statusBox.textContent = message;
  statusBox.className = "status " + kind;
  statusBox.hidden = !message;
  if (message && timeout > 0) {
    statusTimer = window.setTimeout(() => { statusBox.hidden = true; }, timeout);
  }
}

async function readJson(response) {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error("The server returned an empty response (HTTP " + response.status + "). Check the Render service logs.");
  }
  try {
    return JSON.parse(body);
  } catch (_error) {
    throw new Error("The server returned an unexpected response (HTTP " + response.status + "). Check the Render service logs.");
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(value) {
  if (!value) return "Recently added";
  const date = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return "Recently added";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function extensionOf(name) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "file";
}

function renderDocuments() {
  const query = searchInput.value.trim().toLowerCase();
  const matching = documents.filter((doc) => doc.original_name.toLowerCase().includes(query));
  list.replaceChildren();
  subtitle.textContent = documents.length === 1 ? "1 document in your library." : documents.length + " documents in your library.";

  if (documents.length === 0) {
    emptyTitle.textContent = "Nothing here yet";
    emptyCopy.textContent = "Upload your first document and it will show up here.";
    emptyState.hidden = false;
    return;
  }

  if (matching.length === 0) {
    emptyTitle.textContent = "No matching files";
    emptyCopy.textContent = "Try a different search term.";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  for (const doc of matching) {
    const row = document.createElement("article");
    row.className = "document-row";

    const icon = document.createElement("div");
    const extension = extensionOf(doc.original_name);
    icon.className = "file-icon " + extension;
    icon.textContent = extension === "jpeg" ? "JPG" : extension.toUpperCase();
    icon.setAttribute("aria-hidden", "true");

    const info = document.createElement("div");
    info.className = "document-info";
    const name = document.createElement("div");
    name.className = "document-name";
    name.textContent = doc.original_name;
    name.title = doc.original_name;
    const meta = document.createElement("div");
    meta.className = "document-meta";
    const size = document.createElement("span");
    size.textContent = formatSize(Number(doc.size) || 0);
    const dot = document.createElement("span");
    dot.className = "meta-dot";
    dot.textContent = "•";
    const date = document.createElement("span");
    date.textContent = formatDate(doc.uploaded_at);
    meta.append(size, dot, date);
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const download = document.createElement("a");
    download.className = "button button-small";
    download.href = "/api/documents/" + encodeURIComponent(doc.id) + "/download";
    download.textContent = "Download ↓";
    const remove = document.createElement("button");
    remove.className = "button button-small button-delete";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteDocument(doc));
    actions.append(download, remove);
    row.append(icon, info, actions);
    list.appendChild(row);
  }
}

async function loadDocuments(showMessage = false) {
  const response = await fetch("/api/documents", { headers: { Accept: "application/json" } });
  const result = await readJson(response);
  if (!response.ok) throw new Error(result.error || "Could not load documents.");
  if (!Array.isArray(result)) throw new Error("The server returned an invalid document list.");
  documents = result;
  renderDocuments();
  if (showMessage) setStatus("Your library is up to date.", "success");
}

async function deleteDocument(doc) {
  if (!window.confirm("Permanently delete " + doc.original_name + "?")) return;
  try {
    const response = await fetch("/api/documents/" + encodeURIComponent(doc.id), {
      method: "DELETE",
      headers: { Accept: "application/json" }
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Delete failed.");
    await loadDocuments();
    setStatus("Document deleted.", "success");
  } catch (error) {
    setStatus(error.message, "error", 0);
  }
}

function showSelectedFile() {
  fileLabel.textContent = fileInput.files[0] ? fileInput.files[0].name : "Choose a file";
}

fileInput.addEventListener("change", showSelectedFile);
searchInput.addEventListener("input", renderDocuments);

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}
dropzone.addEventListener("drop", (event) => {
  const files = event.dataTransfer && event.dataTransfer.files;
  if (!files || files.length === 0) return;
  fileInput.files = files;
  showSelectedFile();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!fileInput.files || fileInput.files.length === 0) {
    setStatus("Choose a file before uploading.", "error");
    return;
  }

  uploadButton.disabled = true;
  uploadButton.querySelector("span:first-child").textContent = "Uploading…";
  setStatus("Uploading your document…", "info", 0);

  try {
    const response = await fetch("/api/documents", {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" }
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Upload failed.");
    form.reset();
    showSelectedFile();
    await loadDocuments();
    setStatus("Document uploaded successfully.", "success");
  } catch (error) {
    setStatus(error.message, "error", 0);
  } finally {
    uploadButton.disabled = false;
    uploadButton.querySelector("span:first-child").textContent = "Upload document";
  }
});

loadDocuments().catch((error) => {
  renderDocuments();
  setStatus(error.message, "error", 0);
});
