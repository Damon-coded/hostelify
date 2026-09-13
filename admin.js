const adminLogin = document.getElementById("adminLogin");
const adminConsole = document.getElementById("adminConsole");
const adminForm = document.getElementById("adminLoginForm");
let adminKey = sessionStorage.getItem("hostelAdminKey") || "";

// ======================================================
// SMALL POPUP LOADING SCREEN (shown while an admin
// action is talking to the backend)
// ======================================================
const MIN_POPUP_DURATION_MS = 450;

function showActionPopup(text) {
  const popup = document.getElementById("adminActionPopup");
  const textEl = document.getElementById("adminActionPopupText");
  if (textEl) textEl.textContent = text || "Working...";
  if (popup) popup.classList.add("visible");
}

function hideActionPopup() {
  const popup = document.getElementById("adminActionPopup");
  if (popup) popup.classList.remove("visible");
}

// Wraps an async action with the popup, guaranteeing it stays
// visible for at least MIN_POPUP_DURATION_MS so it doesn't just
// flash on fast responses.
async function withActionPopup(text, fn) {
  showActionPopup(text);
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, MIN_POPUP_DURATION_MS - elapsed);
    if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
    hideActionPopup();
  }
}

function showConsole() {
  adminLogin.classList.add("hidden"); adminConsole.classList.remove("hidden");
  loadFormLockStatus();
}
if (adminKey) showConsole();

adminForm.addEventListener("submit", async e => {
  e.preventDefault();
  const key = document.getElementById("adminKey").value;
  const msg = document.getElementById("adminLoginMessage");
  try {
    setLoading(adminForm.querySelector("button"), true, "Checking...");
    await withActionPopup("Verifying admin key...", () => API.verifyAdmin(key));
    adminKey = key;
    sessionStorage.setItem("hostelAdminKey", key);
    showConsole();
  } catch (err) { msg.textContent = err.message; }
  finally { setLoading(adminForm.querySelector("button"), false); }
});

async function loadSummary() {
  const batch = document.getElementById("batchId").value.trim();
  if (!batch) return;
  const msg = document.getElementById("adminMessage");
  try {
    const result = await withActionPopup("Loading batch summary...", () => API.summary(batch, adminKey));
    document.getElementById("total").textContent = result.totalStudents;
    document.getElementById("registered").textContent = result.registered;
    document.getElementById("allocated").textContent = result.allocated;
    document.getElementById("notAllocated").textContent = result.notAllocated;
    msg.className = "form-message success";
    msg.textContent = `Allocation: ${result.allocationStatus || "—"} · Results: ${result.resultStatus || "—"}`;
  } catch (err) { msg.textContent = err.message; }
}
document.getElementById("summaryBtn").addEventListener("click", loadSummary);

async function adminAction(fn, button, popupText, msgId, ...extraArgs) {
  const batch = document.getElementById("batchId").value.trim();
  const msg = document.getElementById(msgId);
  if (!batch) { msg.className = "form-message"; msg.textContent = "Batch ID is required."; return; }
  if (!adminKey) { msg.className = "form-message"; msg.textContent = "Admin session is not authenticated."; return; }
  try {
    setLoading(button, true, "Working...");
    const result = await withActionPopup(popupText || "Processing your request...", () => fn(batch, adminKey, ...extraArgs));
    msg.className = "form-message success"; msg.textContent = result.message || "Action completed.";
    await loadSummary();
  } catch (err) { msg.className = "form-message"; msg.textContent = err.message; }
  finally { setLoading(button, false); }
}
document.getElementById("runBtn").addEventListener("click", e => {
  adminAction(API.allocate, e.currentTarget, "Running allocation...", "runMessage");
});
document.getElementById("publishBtn").addEventListener("click", e => {
  const remarkInput = document.getElementById("publishRemark");
  const remark = remarkInput ? remarkInput.value.trim() : "";
  adminAction(API.publish, e.currentTarget, "Publishing results...", "publishMessage", remark);
});
document.getElementById("unpublishBtn").addEventListener("click", e => adminAction(API.unpublish, e.currentTarget, "Hiding results...", "unpublishMessage"));
document.getElementById("resetBtn").addEventListener("click", async e => {
  if (!confirm("Reset allocation? This will restore all rooms and student statuses.")) return;
  const msg = document.getElementById("resetMessage");
  try {
    setLoading(e.currentTarget, true, "Resetting...");
    const result = await withActionPopup("Resetting allocation...", () => API.reset(adminKey));
    msg.className = "form-message success"; msg.textContent = result.message;
    await loadSummary();
  } catch (err) { msg.className = "form-message"; msg.textContent = err.message; }
  finally { setLoading(e.currentTarget, false); }
});
document.getElementById("adminLogout").addEventListener("click", () => {
  sessionStorage.removeItem("hostelAdminKey"); adminKey = ""; location.reload();
});

// ======================================================
// FORM LOCK CONTROLS (submissions / editing)
// ======================================================
let formLockState = { formSubmissionLocked: false, formEditLocked: false };

async function loadFormLockStatus() {
  if (!adminKey) return;
  try {
    const result = await API.formLockStatus(adminKey);
    formLockState.formSubmissionLocked = !!result.formSubmissionLocked;
    formLockState.formEditLocked = !!result.formEditLocked;
    updateFormLockButtons();
  } catch (err) {
    // Non-critical: leave buttons in their default state.
  }
}

function updateFormLockButtons() {
  const subBtn = document.getElementById("lockSubmissionBtn");
  const editBtn = document.getElementById("lockEditBtn");
  const subMsg = document.getElementById("lockSubmissionMessage");
  const editMsg = document.getElementById("lockEditMessage");

  subBtn.textContent = formLockState.formSubmissionLocked ? "Unlock hostel form" : "Lock hostel form";
  subBtn.classList.toggle("btn-danger", formLockState.formSubmissionLocked);
  subBtn.classList.toggle("btn-dark", !formLockState.formSubmissionLocked);

  editBtn.textContent = formLockState.formEditLocked ? "Unlock edit form" : "Lock edit form";
  editBtn.classList.toggle("btn-danger", formLockState.formEditLocked);
  editBtn.classList.toggle("btn-dark", !formLockState.formEditLocked);

  subMsg.className = "form-message";
  subMsg.textContent = `Submissions are currently ${formLockState.formSubmissionLocked ? "Locked" : "Open"}.`;

  editMsg.className = "form-message";
  editMsg.textContent = `Editing is currently ${formLockState.formEditLocked ? "Locked" : "Open"}.`;
}

document.getElementById("lockSubmissionBtn").addEventListener("click", async e => {
  const btn = e.currentTarget;
  const statusText = document.getElementById("lockSubmissionMessage");
  try {
    setLoading(btn, true, "Updating...");
    const next = !formLockState.formSubmissionLocked;
    await withActionPopup(next ? "Locking hostel form..." : "Unlocking hostel form...", () => API.setFormLock("submission", next, adminKey));
  } catch (err) {
    statusText.className = "form-message";
    statusText.textContent = err.message;
  } finally {
    setLoading(btn, false);
    // Always re-fetch the real state from the backend instead of trusting
    // the optimistic local toggle — this is what makes the button/status
    // text update immediately without needing a page reload.
    await loadFormLockStatus();
  }
});

document.getElementById("lockEditBtn").addEventListener("click", async e => {
  const btn = e.currentTarget;
  const statusText = document.getElementById("lockEditMessage");
  try {
    setLoading(btn, true, "Updating...");
    const next = !formLockState.formEditLocked;
    await withActionPopup(next ? "Locking edit form..." : "Unlocking edit form...", () => API.setFormLock("edit", next, adminKey));
  } catch (err) {
    statusText.className = "form-message";
    statusText.textContent = err.message;
  } finally {
    setLoading(btn, false);
    await loadFormLockStatus();
  }
});

// ======================================================
// SIDEBAR TABS
// ======================================================
document.querySelectorAll(".sidebar-tab").forEach(tabBtn => {
  tabBtn.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
    tabBtn.classList.add("active");
    document.getElementById(`tab-${tabBtn.dataset.tab}`).classList.remove("hidden");

    if (tabBtn.dataset.tab === "occupancy") {
      startOccupancyPolling();
    } else {
      stopOccupancyPolling();
    }
  });
});

// ======================================================
// ALL STUDENTS (plain list, no priority/PWD sorting)
// ======================================================
async function loadAllStudents() {
  const batch = document.getElementById("allStudentsBatchId").value.trim();
  const msg = document.getElementById("allStudentsMessage");
  const tbody = document.getElementById("allStudentsTableBody");
  const btn = document.getElementById("allStudentsBtn");

  if (!batch) { msg.textContent = "Batch ID is required."; return; }
  if (!adminKey) { msg.textContent = "Admin session is not authenticated."; return; }

  try {
    setLoading(btn, true, "Loading...");
    msg.className = "form-message";
    msg.textContent = "";

    const result = await withActionPopup("Loading all students...", () => API.allStudents(batch, adminKey));
    const students = result.students || [];

    if (students.length === 0) {
  tbody.innerHTML = `<tr><td colspan="15" class="priority-empty">No students found for this batch.</td></tr>`;
} else {
  tbody.innerHTML = students.map((s, i) => `
    <tr class="${isPwd(s) ? "pwd-priority-row" : ""}">
      <td>${i + 1}</td>
      <td>${escapeHtml(s.studentId)}</td>
      <td>${escapeHtml(s.name || "—")}</td>
      <td>${escapeHtml(s.region || "—")}</td>
      <td>${escapeHtml(s.state || "—")}</td>
      <td>${s.zone !== "" && s.zone != null ? s.zone : "—"}</td>
      <td>${s.campusDistanceKm !== "" && s.campusDistanceKm != null ? s.campusDistanceKm : "—"}</td>
      <td>${escapeHtml(s.course || "—")}</td>
      <td>${escapeHtml(String(s.year || "—"))}</td>
      <td>${escapeHtml(s.hostelPreference || "—")}</td>
      <td>${isPwd(s) ? `<span class="status-pill status-allocated">Yes</span>` : "No"}</td>
      <td><span class="status-pill status-${slug(s.status)}">${escapeHtml(s.status || "—")}</span></td>
      <td>${escapeHtml(s.allocatedHostelId || "—")}</td>
      <td>${escapeHtml(s.allocatedRoomId || "—")}</td>
      <td>${s.allocationScore !== "" && s.allocationScore != null ? s.allocationScore : "—"}</td>
    </tr>
  `).join("");
}

    msg.className = "form-message success";
    msg.textContent = `Loaded ${students.length} student(s)`;
  } catch (err) {
    msg.textContent = err.message;
    tbody.innerHTML = `<tr><td colspan="10" class="priority-empty">Unable to load students.</td></tr>`;
  } finally {
    setLoading(btn, false);
  }
}
document.getElementById("allStudentsBtn").addEventListener("click", loadAllStudents);

// ======================================================
// PRIORITY LIST
// ======================================================
async function loadPriorityList() {
  const batch = document.getElementById("priorityBatchId").value.trim();
  const msg = document.getElementById("priorityMessage");
  const tbody = document.getElementById("priorityTableBody");
  const btn = document.getElementById("priorityBtn");

  if (!batch) { msg.textContent = "Batch ID is required."; return; }
  if (!adminKey) { msg.textContent = "Admin session is not authenticated."; return; }

  try {
    setLoading(btn, true, "Loading...");
    msg.className = "form-message";
    msg.textContent = "";

    const result = await withActionPopup("Loading priority list...", () => API.priorityList(batch, adminKey));

    // PWD (person-with-disability) students are pulled to the top of the
    // priority list, ahead of everyone else. Array.prototype.sort is a
    // stable sort in modern JS engines, so within each group (PWD / non-PWD)
    // students keep the relative order the backend already gave them.
    const students = (result.students || []).slice().sort((a, b) => isPwd(b) - isPwd(a));

  if (students.length === 0) {
  tbody.innerHTML = `<tr><td colspan="15" class="priority-empty">No students found for this batch.</td></tr>`;
} else {
  tbody.innerHTML = students.map((s, i) => `
    <tr class="${isPwd(s) ? "pwd-priority-row" : ""}">
      <td>${i + 1}</td>
      <td>${escapeHtml(s.studentId)}</td>
      <td>${escapeHtml(s.name || "—")}</td>
      <td>${escapeHtml(s.region || "—")}</td>
      <td>${escapeHtml(s.state || "—")}</td>
      <td>${s.zone !== "" && s.zone != null ? s.zone : "—"}</td>
      <td>${s.campusDistanceKm !== "" && s.campusDistanceKm != null ? s.campusDistanceKm : "—"}</td>
      <td>${escapeHtml(s.course || "—")}</td>
      <td>${escapeHtml(String(s.year || "—"))}</td>
      <td>${escapeHtml(s.hostelPreference || "—")}</td>
      <td>${isPwd(s) ? `<span class="status-pill status-allocated">Yes</span>` : "No"}</td>
      <td><span class="status-pill status-${slug(s.status)}">${escapeHtml(s.status || "—")}</span></td>
      <td>${escapeHtml(s.allocatedHostelId || "—")}</td>
      <td>${escapeHtml(s.allocatedRoomId || "—")}</td>
      <td>${s.allocationScore !== "" && s.allocationScore != null ? s.allocationScore : "—"}</td>
    </tr>
  `).join("");
}
    msg.className = "form-message success";
    msg.textContent = `Loaded ${students.length} student(s)`;
  } catch (err) {
  msg.textContent = err.message;
  tbody.innerHTML = `<tr><td colspan="15" class="priority-empty">Unable to load priority list.</td></tr>`;
} finally {
    setLoading(btn, false);
  }
}
document.getElementById("priorityBtn").addEventListener("click", loadPriorityList);

// ======================================================
// LIVE OCCUPANCY / HOSTEL STATS
// ======================================================

let occupancyPollTimer = null;
const OCCUPANCY_POLL_INTERVAL_MS = 15000;

async function loadOccupancy(manual) {
  const msg = document.getElementById("occupancyMessage");
  const listEl = document.getElementById("occupancyHostelList");
  const lastUpdated = document.getElementById("occupancyLastUpdated");

  if (!adminKey) { msg.textContent = "Admin session is not authenticated."; return; }

  try {
    const result = manual
      ? await withActionPopup("Refreshing occupancy data...", () => API.occupancy(adminKey))
      : await API.occupancy(adminKey);
    const totals = result.totals || {};
    const hostels = result.hostels || [];

    document.getElementById("occTotalRooms").textContent = totals.totalRooms ?? "—";
    document.getElementById("occOccupied").textContent = totals.occupied ?? "—";
    document.getElementById("occAvailable").textContent = totals.available ?? "—";
    document.getElementById("occRate").textContent = totals.occupancyPercent != null ? `${totals.occupancyPercent}%` : "—";

    renderOccupancyHostelList(listEl, hostels);

    msg.className = "form-message";
    msg.textContent = "";
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    msg.className = "form-message";
    msg.textContent = err.message;
  }
}
document.getElementById("occupancyRefreshBtn").addEventListener("click", () => loadOccupancy(true));

function renderOccupancyHostelList(listEl, hostels) {
  // Remember which hostel blocks were expanded, so a live refresh
  // doesn't collapse whatever the admin currently has open.
  const expandedIds = new Set(
    Array.from(listEl.querySelectorAll(".hostel-block.expanded"))
      .map(el => el.dataset.hostelId)
  );

  if (hostels.length === 0) {
    listEl.innerHTML = `<p class="priority-empty">No hostel/room data found.</p>`;
    return;
  }

  listEl.innerHTML = hostels.map(h => {
    const rooms = h.rooms || [];
    const isExpanded = expandedIds.has(h.hostelId);

    const roomRows = rooms.length === 0
      ? `<tr><td colspan="4" class="priority-empty">No rooms found for this hostel.</td></tr>`
      : rooms.map(r => `
        <tr>
          <td>${escapeHtml(r.roomId)}</td>
          <td><span class="status-pill status-${slug(r.status)}">${escapeHtml(r.status || "—")}</span></td>
          <td>${r.occupantStudentId ? `${escapeHtml(r.occupantStudentId)}${r.occupantName ? " — " + escapeHtml(r.occupantName) : ""}` : "—"}</td>
          <td>${r.reservedForPwd ? `<span class="status-pill status-allocated">PWD</span>` : "—"}</td>
        </tr>
      `).join("");

    return `
      <div class="hostel-block${isExpanded ? " expanded" : ""}" data-hostel-id="${escapeHtml(h.hostelId)}">
        <button class="hostel-block-header" type="button">
          <div class="hostel-block-title">
            <strong>${escapeHtml(h.hostelName || h.hostelId || "Unnamed hostel")}</strong>
            <span class="hostel-block-sub">${escapeHtml(h.hostelId)}${h.gender ? " · " + escapeHtml(h.gender) : ""}</span>
          </div>
          <div class="hostel-block-meta">
            <span class="occ-chip occ-chip-occupied">${h.occupied} Occupied</span>
            <span class="occ-chip occ-chip-available">${h.available} Available</span>
            <span class="occ-chip occ-chip-rate">${h.occupancyPercent}%</span>
            <span class="hostel-block-chevron">▾</span>
          </div>
        </button>
        <div class="hostel-block-body${isExpanded ? "" : " hidden"}">
          <table class="room-table">
            <thead><tr><th>Room</th><th>Status</th><th>Occupant</th><th>Reserved</th></tr></thead>
            <tbody>${roomRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".hostel-block-header").forEach(headerBtn => {
    headerBtn.addEventListener("click", () => {
      const block = headerBtn.closest(".hostel-block");
      const body = block.querySelector(".hostel-block-body");
      block.classList.toggle("expanded");
      body.classList.toggle("hidden");
    });
  });
}

document.getElementById("occupancyExpandAllBtn").addEventListener("click", () => {
  document.querySelectorAll("#occupancyHostelList .hostel-block").forEach(block => {
    block.classList.add("expanded");
    block.querySelector(".hostel-block-body").classList.remove("hidden");
  });
});
document.getElementById("occupancyCollapseAllBtn").addEventListener("click", () => {
  document.querySelectorAll("#occupancyHostelList .hostel-block").forEach(block => {
    block.classList.remove("expanded");
    block.querySelector(".hostel-block-body").classList.add("hidden");
  });
});

function startOccupancyPolling() {
  stopOccupancyPolling();
  loadOccupancy();
  occupancyPollTimer = setInterval(loadOccupancy, OCCUPANCY_POLL_INTERVAL_MS);
}

function stopOccupancyPolling() {
  if (occupancyPollTimer) {
    clearInterval(occupancyPollTimer);
    occupancyPollTimer = null;
  }
}

function isPwd(student) {
  const v = String(student.pwd || "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "y" ? 1 : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
function slug(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}
