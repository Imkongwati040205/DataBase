const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const authTitle = document.querySelector("#auth-title");
const authSubtitle = document.querySelector("#auth-subtitle");
const authSubmit = document.querySelector("#auth-submit");
const authSwitchCopy = document.querySelector("#auth-switch-copy");
const authSwitchButton = document.querySelector("#auth-switch-button");
const nameField = document.querySelector("#name-field");
const signedInBar = document.querySelector("#signed-in-bar");
const userName = document.querySelector("#user-name");
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
const dialog = document.querySelector("#document-dialog");
const detailStatus = document.querySelector("#detail-status");
const versionForm = document.querySelector("#version-form");
const versionFile = document.querySelector("#version-file");
const versionSubmit = document.querySelector("#version-submit");
const shareForm = document.querySelector("#share-form");
const commentForm = document.querySelector("#comment-form");

let authMode = "login";
let currentUser = null;
let documents = [];
let selectedDocument = null;
let statusTimer;

async function api(url, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, { ...options, headers });
  const body = await response.text();
  let result = {};
  if (body.trim()) {
    try {
      result = JSON.parse(body);
    } catch (_error) {
      throw new Error("The server returned an unexpected response (HTTP " + response.status + "). Check the Render logs.");
    }
  } else if (!response.ok) {
    throw new Error("The server returned an empty response (HTTP " + response.status + "). Check the Render logs.");
  }
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}

function setStatus(element, message, kind = "info", timeout = 5000) {
  const timerKey = element === detailStatus ? "detailStatusTimer" : "statusTimer";
  window.clearTimeout(setStatus[timerKey]);
  element.textContent = message;
  element.className = "status " + kind;
  element.hidden = !message;
  if (message && timeout > 0) {
    setStatus[timerKey] = window.setTimeout(() => { element.hidden = true; }, timeout);
  }
}

function setAuthMessage(message, kind = "error") {
  authStatus.textContent = message;
  authStatus.className = "status " + kind;
  authStatus.hidden = !message;
}

function showSignedIn(user) {
  currentUser = user;
  authView.hidden = true;
  appView.hidden = false;
  signedInBar.hidden = false;
  userName.textContent = user.displayName;
  document.querySelector("#welcome-name").textContent = user.displayName.split(" ")[0];
  loadDocuments();
}

function showSignedOut() {
  currentUser = null;
  appView.hidden = true;
  signedInBar.hidden = true;
  authView.hidden = false;
  setAuthMessage("");
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  nameField.hidden = !registering;
  document.querySelector("#display-name").required = registering;
  document.querySelector("#password").autocomplete = registering ? "new-password" : "current-password";
  authTitle.textContent = registering ? "Create your account" : "Sign in to your library";
  authSubtitle.textContent = registering ? "Your private workspace starts here." : "Pick up where you left off.";
  authSubmit.innerHTML = registering ? 'Create account <span aria-hidden="true">↗</span>' : 'Sign in <span aria-hidden="true">↗</span>';
  authSwitchCopy.textContent = registering ? "Already have an account?" : "New here?";
  authSwitchButton.textContent = registering ? "Sign in" : "Create an account";
  setAuthMessage("");
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(value) {
  if (!value) return "Recently added";
  const date = new Date(value);
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
  document.querySelector("#document-count").textContent = documents.length;
  document.querySelector("#version-count").textContent = documents.reduce((total, doc) => total + (Number(doc.version_count) || 0), 0);

  if (documents.length === 0 || matching.length === 0) {
    emptyTitle.textContent = documents.length === 0 ? "Nothing here yet" : "No matching files";
    emptyCopy.textContent = documents.length === 0 ? "Upload a document to begin your library." : "Try a different search term.";
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
    size.textContent = formatSize(doc.size);
    const dot = document.createElement("span");
    dot.className = "meta-dot";
    dot.textContent = "•";
    const versionMeta = document.createElement("span");
    versionMeta.textContent = "v" + doc.latest_version + " · " + doc.version_count + " version" + (Number(doc.version_count) === 1 ? "" : "s");
    const role = document.createElement("span");
    role.className = "role-inline";
    role.textContent = doc.role === "owner" ? "Owner" : (doc.role === "editor" ? "Editor" : "Viewer");
    meta.append(size, dot, versionMeta, role);
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const download = document.createElement("a");
    download.className = "button button-small";
    download.href = "/api/documents/" + encodeURIComponent(doc.id) + "/download";
    download.textContent = "Download ↓";
    const details = document.createElement("button");
    details.className = "button button-small button-details";
    details.type = "button";
    details.textContent = "Versions & team";
    details.addEventListener("click", () => openDocument(doc));
    actions.append(download, details);

    if (doc.role === "owner") {
      const remove = document.createElement("button");
      remove.className = "button button-small button-delete";
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => deleteDocument(doc));
      actions.appendChild(remove);
    }

    row.append(icon, info, actions);
    list.appendChild(row);
  }
}

async function loadDocuments() {
  try {
    documents = await api("/api/documents");
    renderDocuments();
  } catch (error) {
    if (error.message.includes("sign in")) return showSignedOut();
    setStatus(statusBox, error.message, "error", 0);
  }
}

async function deleteDocument(doc) {
  if (!window.confirm("Permanently delete " + doc.original_name + " and its version history?")) return;
  try {
    await api("/api/documents/" + encodeURIComponent(doc.id), { method: "DELETE" });
    await loadDocuments();
    setStatus(statusBox, "Document and its history deleted.", "success");
  } catch (error) {
    setStatus(statusBox, error.message, "error", 0);
  }
}

function makeMeta(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function renderVersions(versions, role) {
  const versionList = document.querySelector("#version-list");
  versionList.replaceChildren();
  versionForm.hidden = role === "viewer";
  versionFile.required = role !== "viewer";
  for (const version of versions) {
    const item = document.createElement("div");
    item.className = "version-item";
    const icon = document.createElement("span");
    icon.className = "version-number";
    icon.textContent = "v" + version.version_number;
    const details = document.createElement("div");
    details.className = "version-details";
    const title = document.createElement("strong");
    title.textContent = version.original_name;
    const meta = document.createElement("small");
    meta.textContent = formatSize(version.file_size) + " · " + formatDate(version.uploaded_at) + " · by " + version.uploaded_by;
    details.append(title, meta);
    const download = document.createElement("a");
    download.className = "button button-small";
    download.href = "/api/documents/" + encodeURIComponent(selectedDocument.id) + "/versions/" + encodeURIComponent(version.version_number) + "/download";
    download.textContent = "Download";
    item.append(icon, details, download);
    versionList.appendChild(item);
  }
}

function renderCollaborators(data) {
  const section = document.querySelector("#sharing-section");
  const collaboratorList = document.querySelector("#collaborator-list");
  const isOwner = data.role === "owner";
  section.hidden = !isOwner;
  collaboratorList.replaceChildren();
  if (!isOwner) return;
  for (const person of data.collaborators) {
    const row = document.createElement("div");
    row.className = "collaborator-row";
    const avatar = document.createElement("span");
    avatar.className = "collaborator-avatar";
    avatar.textContent = person.display_name.slice(0, 1).toUpperCase();
    const identity = document.createElement("span");
    identity.className = "collaborator-identity";
    const name = document.createElement("strong");
    name.textContent = person.display_name;
    const email = document.createElement("small");
    email.textContent = person.email;
    identity.append(name, email);
    const role = document.createElement("span");
    role.className = "collaborator-role";
    role.textContent = person.role === "editor" ? "Editor" : "Viewer";
    const remove = document.createElement("button");
    remove.className = "remove-collaborator";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      try {
        await api("/api/documents/" + encodeURIComponent(selectedDocument.id) + "/collaborators/" + encodeURIComponent(person.id), { method: "DELETE" });
        await loadCollaborators();
        setStatus(detailStatus, "Sharing access removed.", "success");
      } catch (error) {
        setStatus(detailStatus, error.message, "error", 0);
      }
    });
    row.append(avatar, identity, role, remove);
    collaboratorList.appendChild(row);
  }
  if (data.collaborators.length === 0) {
    const empty = document.createElement("p");
    empty.className = "subtle-empty";
    empty.textContent = "You haven’t shared this document yet.";
    collaboratorList.appendChild(empty);
  }
}

async function loadCollaborators() {
  const data = await api("/api/documents/" + encodeURIComponent(selectedDocument.id) + "/collaborators");
  renderCollaborators(data);
}

function renderComments(comments) {
  const commentList = document.querySelector("#comment-list");
  commentList.replaceChildren();
  if (comments.length === 0) {
    const empty = document.createElement("p");
    empty.className = "subtle-empty";
    empty.textContent = "No notes yet. Start the conversation.";
    commentList.appendChild(empty);
    return;
  }
  for (const comment of comments) {
    const item = document.createElement("article");
    item.className = "comment-item";
    const heading = document.createElement("div");
    heading.className = "comment-heading";
    const author = document.createElement("strong");
    author.textContent = comment.display_name;
    const time = document.createElement("time");
    time.textContent = formatDate(comment.created_at);
    heading.append(author, time);
    const body = document.createElement("p");
    body.textContent = comment.body;
    item.append(heading, body);
    commentList.appendChild(item);
  }
}

async function openDocument(doc) {
  selectedDocument = doc;
  document.querySelector("#dialog-title").textContent = doc.original_name;
  document.querySelector("#dialog-role").textContent = doc.role === "owner" ? "Owner" : (doc.role === "editor" ? "Editor access" : "View only");
  versionForm.reset();
  document.querySelector("#comment-list").replaceChildren();
  setStatus(detailStatus, "Loading document workspace…", "info", 0);
  dialog.showModal();
  try {
    const [versionData, comments] = await Promise.all([
      api("/api/documents/" + encodeURIComponent(doc.id) + "/versions"),
      api("/api/documents/" + encodeURIComponent(doc.id) + "/comments")
    ]);
    renderVersions(versionData.versions, versionData.role);
    renderComments(comments);
    await loadCollaborators();
    setStatus(detailStatus, "", "info");
  } catch (error) {
    setStatus(detailStatus, error.message, "error", 0);
  }
}

document.querySelector("#auth-switch-button").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = authSubmit;
  submitButton.disabled = true;
  setAuthMessage(authMode === "register" ? "Creating your account…" : "Signing you in…", "info");
  const payload = {
    displayName: document.querySelector("#display-name").value,
    email: document.querySelector("#email").value,
    password: document.querySelector("#password").value
  };
  try {
    const result = await api("/api/auth/" + authMode, { method: "POST", body: JSON.stringify(payload) });
    authForm.reset();
    showSignedIn(result.user);
  } catch (error) {
    setAuthMessage(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    documents = [];
    renderDocuments();
    showSignedOut();
  }
});

fileInput.addEventListener("change", () => {
  fileLabel.textContent = fileInput.files[0] ? fileInput.files[0].name : "Choose a file";
});
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
  fileLabel.textContent = files[0].name;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!fileInput.files || fileInput.files.length === 0) {
    setStatus(statusBox, "Choose a file before uploading.", "error");
    return;
  }
  uploadButton.disabled = true;
  uploadButton.querySelector("span:first-child").textContent = "Uploading…";
  setStatus(statusBox, "Uploading your document…", "info", 0);
  try {
    await api("/api/documents", { method: "POST", body: new FormData(form) });
    form.reset();
    fileLabel.textContent = "Choose a file";
    await loadDocuments();
    setStatus(statusBox, "Document uploaded. You can now add collaborators or versions.", "success");
  } catch (error) {
    setStatus(statusBox, error.message, "error", 0);
  } finally {
    uploadButton.disabled = false;
    uploadButton.querySelector("span:first-child").textContent = "Upload document";
  }
});

versionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDocument || !versionFile.files[0]) return;
  versionSubmit.disabled = true;
  try {
    await api("/api/documents/" + encodeURIComponent(selectedDocument.id) + "/versions", { method: "POST", body: new FormData(versionForm) });
    await openDocument(selectedDocument);
    await loadDocuments();
    setStatus(detailStatus, "New version saved; the earlier version is still available.", "success");
  } catch (error) {
    setStatus(detailStatus, error.message, "error", 0);
  } finally {
    versionSubmit.disabled = false;
  }
});

shareForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDocument) return;
  const email = document.querySelector("#share-email").value;
  const role = document.querySelector("#share-role").value;
  try {
    await api("/api/documents/" + encodeURIComponent(selectedDocument.id) + "/collaborators", {
      method: "POST",
      body: JSON.stringify({ email, role })
    });
    shareForm.reset();
    await loadCollaborators();
    await loadDocuments();
    setStatus(detailStatus, "Document shared with " + email + ".", "success");
  } catch (error) {
    setStatus(detailStatus, error.message, "error", 0);
  }
});

commentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDocument) return;
  const body = document.querySelector("#comment-body").value;
  try {
    await api("/api/documents/" + encodeURIComponent(selectedDocument.id) + "/comments", {
      method: "POST",
      body: JSON.stringify({ body })
    });
    commentForm.reset();
    renderComments(await api("/api/documents/" + encodeURIComponent(selectedDocument.id) + "/comments"));
    setStatus(detailStatus, "Note posted.", "success");
  } catch (error) {
    setStatus(detailStatus, error.message, "error", 0);
  }
});

document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

api("/api/auth/me")
  .then((result) => result.user ? showSignedIn(result.user) : showSignedOut())
  .catch(() => showSignedOut());
