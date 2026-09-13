// Replace this with your deployed Apps Script Web App URL.
const API_URL = "https://script.google.com/macros/s/AKfycbyNlcuZSiiIfP4xB5aQwH5x0sbnK59AElv-2ZZ-W1nE7XUY_cz1yCC5VIMczoRrJkIObg/exec";

async function apiPost(action, data = {}) {
  if (!API_URL || API_URL.includes("YOUR_APPS_SCRIPT")) {
    throw new Error("Set API_URL in api.js to your deployed Apps Script Web App URL.");
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type": "text/plain;charset=utf-8"},
    body: JSON.stringify({action, ...data})
  });
  const result = await response.json();
  if (!result.success && result.message) throw new Error(result.message);
  return result;
}

async function apiGet(action, params = {}) {
  if (!API_URL || API_URL.includes("YOUR_APPS_SCRIPT")) {
    throw new Error("Set API_URL in api.js to your deployed Apps Script Web App URL.");
  }
  const qs = new URLSearchParams({action, ...params});
  const response = await fetch(`${API_URL}?${qs.toString()}`);
  const result = await response.json();
  if (!result.success && result.message && action !== "getStudentResult") throw new Error(result.message);
  return result;
}

const API = {
  login: (studentId, password) => apiPost("loginStudent", {studentId, password}),
  register: student => apiPost("registerStudent", student),
  profile: studentId => apiPost("getStudentProfile", {studentId}),
  completeProfile: profile => apiPost("completeStudentProfile", profile),
  editProfile: profile => apiPost("editStudentProfile", profile),
  cancelRegistration: studentId => apiPost("cancelRegistration", {studentId}),
  cancelAllocation: studentId => apiPost("cancelStudentAllocation", {studentId}),
  result: studentId => apiGet("getStudentResult", {studentId}),
  priority: studentId => apiPost("getStudentPriority", {studentId}),
  summary: (batchId, adminKey) => apiPost("getBatchSummary", {batchId, adminKey}),
  allocate: (batchId, adminKey) => apiPost("runAllocation", {batchId, adminKey}),
  publish: (batchId, adminKey, remark) => apiPost("publishResults", {batchId, adminKey, remark}),
  unpublish: (batchId, adminKey) => apiPost("unpublishResults", {batchId, adminKey}),
  reset: adminKey => apiPost("resetAllocation", {adminKey}),
  verifyAdmin: adminKey => apiPost("verifyAdmin", {adminKey}),
  priorityList: (batchId, adminKey) => apiPost("getPriorityList", {batchId, adminKey}),
  allStudents: (batchId, adminKey) => apiPost("getAllStudents", {batchId, adminKey}),
  occupancy: adminKey => apiPost("getOccupancyStats", {adminKey}),
  formLockStatus: adminKey => apiPost("getFormLockStatus", {adminKey}),
  setFormLock: (lockType, locked, adminKey) => apiPost("setFormLock", {lockType, locked, adminKey}),
  formLockStatusPublic: () => apiPost("getFormLockStatusPublic", {}),
  announcements: () => apiPost("getPublicAnnouncements", {})
};

// ======================================================
// THEME TOGGLE (light/dark) — shared across every page
// ======================================================
(function () {
  const THEME_KEY = "hostelHubTheme";

  // Pages that should always render in light mode regardless of
  // any theme saved from another page (e.g. sign in / sign up),
  // flagged via <html data-force-light-theme> in that page's markup.
  const forceLight = document.documentElement.hasAttribute("data-force-light-theme");

  function preferredTheme() {
    if (forceLight) return "light";
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll(".theme-toggle").forEach(btn => {
      btn.textContent = theme === "dark" ? "☀️" : "🌙";
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
      btn.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    });
  }

  applyTheme(preferredTheme());

  function wireToggles() {
    document.querySelectorAll(".theme-toggle").forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "true";
      btn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireToggles);
  } else {
    wireToggles();
  }
})();

function setLoading(button, loading, text) {
  if (!button) return;
  if (loading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${text || "Working..."}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.original || "Continue";
  }
}
