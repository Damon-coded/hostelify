const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const message = document.getElementById("loginMessage");
    const button = loginForm.querySelector("button");
    message.textContent = "";
    try {
      setLoading(button, true, "Signing in...");
      const result = await API.login(
        document.getElementById("studentId").value.trim(),
        document.getElementById("password").value
      );
      sessionStorage.setItem("studentSession", JSON.stringify({
        studentId: result.studentId,
        name: result.name,
        status: result.status
      }));
      window.location.href = "student.html";
    } catch (err) {
      message.textContent = err.message;
    } finally { setLoading(button, false); }
  });
}


// ======================================================
// ANNOUNCEMENTS PANEL (sign-in page)
// ======================================================
// Reflects live admin state: publish/hide results,
// lock/unlock the hostel form, lock/unlock editing.
// Polls periodically so it stays current without a
// page reload.

function escapeAnnouncementText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

async function loadAnnouncements() {
  const listEl = document.getElementById("announcementList");
  if (!listEl) return;

  try {
    const result = await API.announcements();
    const items = [];

    if (result.resultStatus === "PUBLISHED") {
      items.push({
        status: "positive",
        title: "Allocation results are live!",
        text: result.resultRemark && String(result.resultRemark).trim()
          ? result.resultRemark
          : "Sign in to view your hostel and room allocation."
      });
    } else {
      items.push({
        status: "neutral",
        title: "Results not published yet",
        text: "Allocation results haven't been published. Check back soon."
      });
    }

    items.push({
      status: result.formSubmissionLocked ? "warning" : "positive",
      title: result.formSubmissionLocked ? "Hostel form submissions locked" : "Hostel form submissions open",
      text: result.formSubmissionLocked
        ? "The admin has temporarily paused new hostel form submissions."
        : "Registered students can submit the hostel form now."
    });

    items.push({
      status: result.formEditLocked ? "warning" : "positive",
      title: result.formEditLocked ? "Form editing locked" : "Form editing open",
      text: result.formEditLocked
        ? "Editing an already-submitted hostel form is temporarily disabled."
        : "Students can edit their submitted form before allocation runs."
    });

    listEl.innerHTML = items.map(item => `
      <div class="announcement-item status-${item.status}">
        <span class="announcement-dot"></span>
        <div><strong>${escapeAnnouncementText(item.title)}</strong><p>${escapeAnnouncementText(item.text)}</p></div>
      </div>
    `).join("");

  } catch (err) {
    listEl.innerHTML = `
      <div class="announcement-item">
        <span class="announcement-dot"></span>
        <div><strong>Unable to load announcements</strong><p>${escapeAnnouncementText(err.message)}</p></div>
      </div>
    `;
  }
}

if (document.getElementById("announcementList")) {
  loadAnnouncements();
  setInterval(loadAnnouncements, 20000);
}
