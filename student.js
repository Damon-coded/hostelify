const session = JSON.parse(
  sessionStorage.getItem("studentSession") || "null"
);

let editingMode = false;

let formLockState = { formSubmissionLocked: false, formEditLocked: false };

// ======================================================
// FAKE LOADING SCREEN
// ======================================================
// Shown from page load until every startup fetch (form
// lock status, profile, priority, result) has resolved.
// A minimum display time + a slow, staged progress bar
// keep it from flashing on fast connections.

function showPageLoader() {
  const loader = document.getElementById("pageLoader");
  const fill = document.getElementById("loaderBarFill");
  const text = document.getElementById("loaderText");

  const messages = [
    "Loading your dashboard...",
    "Fetching your profile...",
    "Checking your allocation status...",
    "Almost there..."
  ];

  let msgIndex = 0;
  let progress = 0;
  const startTime = Date.now();
  const minDuration = 900;

  const progressTimer = setInterval(() => {
    // Slow down as it approaches the fake ceiling so it
    // never looks "done" before the real work finishes.
    progress += Math.random() * (progress < 60 ? 16 : 4);
    if (progress > 88) progress = 88;
    if (fill) fill.style.width = progress + "%";
  }, 220);

  const textTimer = setInterval(() => {
    msgIndex = (msgIndex + 1) % messages.length;
    if (text) text.textContent = messages[msgIndex];
  }, 950);

  return {
    async finish() {
      clearInterval(progressTimer);
      clearInterval(textTimer);

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minDuration - elapsed);
      if (remaining) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }

      if (fill) fill.style.width = "100%";
      if (text) text.textContent = "Ready.";

      await new Promise(resolve => setTimeout(resolve, 350));

      if (loader) {
        loader.classList.add("loader-hidden");
        setTimeout(() => { loader.style.display = "none"; }, 500);
      }
    }
  };
}

// ======================================================
// SESSION CHECK
// ======================================================

if (!session) {
  const loader = document.getElementById("pageLoader");
  if (loader) loader.style.display = "none";
  window.location.href = "index.html#login";
} else {
  initializeStudentPortal();
}


// ======================================================
// LOAD FORM LOCK STATUS (submission / edit locks)
// ======================================================

async function loadFormLockStatus() {
  try {
    const result = await API.formLockStatusPublic();
    formLockState.formSubmissionLocked = !!result.formSubmissionLocked;
    formLockState.formEditLocked = !!result.formEditLocked;
  } catch (err) {
    // If this check fails for any reason, don't block the rest
    // of the portal - just assume unlocked.
    formLockState.formSubmissionLocked = false;
    formLockState.formEditLocked = false;
  }
}


// ======================================================
// USER HEADER
// ======================================================

function setUserHeader(name) {
  const safeName = name || "Student";

  const userName = document.getElementById("userName");
  const welcomeName = document.getElementById("welcomeName");
  const userInitials = document.getElementById("userInitials");

  if (userName) {
    userName.textContent = safeName;
  }

  if (welcomeName) {
    welcomeName.textContent = safeName.split(" ")[0];
  }

  if (userInitials) {
    userInitials.textContent =
      safeName
        .split(/\s+/)
        .map(x => x[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "ST";
  }
}


// ======================================================
// TOGGLE EDIT / CANCEL REGISTRATION VISIBILITY
// ======================================================
// These actions only make sense BEFORE allocation has
// run (status still "Registered"). Once allocation runs,
// status becomes "Allocated" or "Not Allocated", and the
// backend itself will refuse edits/cancellations anyway —
// this just keeps the UI in sync with that rule.

function updateFormActionButtons(status) {

  const editBtn =
    document.getElementById("editProfileBtn");

  const cancelRegBtn =
    document.getElementById("cancelRegistrationBtn");

  const allocationNotRunYet =
    (status || "Registered") === "Registered";

  if (editBtn) {
    editBtn.classList.toggle("hidden", !allocationNotRunYet);

    const editLocked = formLockState.formEditLocked;
    editBtn.disabled = !allocationNotRunYet || editLocked;
    editBtn.title = editLocked
      ? "Editing is currently locked by the admin."
      : "";
  }

  if (cancelRegBtn) {
    cancelRegBtn.classList.toggle("hidden", !allocationNotRunYet);
  }
}


// ======================================================
// FILL PROFILE FORM
// ======================================================

function fillProfile(profile) {
  document.getElementById("pName").value =
    profile.name || "";

  document.getElementById("pEmail").value =
    profile.email || "";

  // ------------------------------
  // Gender
  // ------------------------------

  const genderSelect =
    document.getElementById("pGender");

  genderSelect.value =
    profile.gender || "";

  // ------------------------------
  // PWD
  // ------------------------------

  document.getElementById("pPwd").value =
    profile.pwd || "No";

  // ------------------------------
  // Academic details
  // ------------------------------

  document.getElementById("pCourse").value =
    profile.course || "";

  document.getElementById("pYear").value =
    profile.year || "";

  // ------------------------------
  // Hostel preference
  // ------------------------------

  updateHostelPreferences();

  const hostelPreference =
    document.getElementById("pPreference");

  const savedHostel =
    profile.hostelPreference || "";

  // Only restore a hostel that is valid
  // for the selected gender.
   const allowedHostels =
    profile.gender === "Male"
      ? ["H01", "H02"]
      : profile.gender === "Female"
        ? ["H03", "H04"]
        : [];

  if (allowedHostels.includes(savedHostel)) {
    hostelPreference.value = savedHostel;
  }

  // ------------------------------
  // Location
  // ------------------------------

  document.getElementById("pState").value =
    profile.state || "";

  document.getElementById("pPin").value =
    profile.housePincode || "";
}


// ======================================================
// LOAD STUDENT PROFILE
// ======================================================

async function loadProfile() {
  const result = await API.profile(session.studentId);

  setUserHeader(result.name || session.name);

  // Update local session with latest backend information
  const updatedSession = {
    ...session,
    name: result.name || session.name,
    status: result.status || session.status || "Registered",
    profileComplete: result.profileComplete === true
  };

  sessionStorage.setItem(
    "studentSession",
    JSON.stringify(updatedSession)
  );

  // Update current session object too
  Object.assign(session, updatedSession);

  // Fill existing information into the form
  fillProfile(result);

  const profileCard =
    document.getElementById("profileCard");

  const submittedNotice =
    document.getElementById("profileSubmittedNotice");

  const notPublished =
    document.getElementById("notPublished");

  const resultCard =
    document.getElementById("resultCard");

  const applicationStatus =
    document.getElementById("applicationStatus");


  // ====================================================
  // FORM NOT SUBMITTED
  // ====================================================

  if (
    result.profileComplete !== true &&
    result.alreadySubmitted !== true
  ) {

    const formLockedNotice =
      document.getElementById("formLockedNotice");

    if (formLockState.formSubmissionLocked) {

      profileCard.classList.add("hidden");

      if (formLockedNotice) {
        formLockedNotice.classList.remove("hidden");
      }

    } else {

      profileCard.classList.remove("hidden");

      if (formLockedNotice) {
        formLockedNotice.classList.add("hidden");
      }
    }

    submittedNotice.classList.add("hidden");

    notPublished.classList.add("hidden");

    resultCard.classList.add("hidden");

    applicationStatus.textContent =
      result.status || "Registered";

    updateFormActionButtons(result.status);

    return false;
  }


  // ====================================================
  // FORM ALREADY SUBMITTED
  // ====================================================

  profileCard.classList.add("hidden");

  submittedNotice.classList.remove("hidden");

  {
    const formLockedNotice =
      document.getElementById("formLockedNotice");

    if (formLockedNotice) {
      formLockedNotice.classList.add("hidden");
    }
  }

  applicationStatus.textContent =
    result.status || "Submitted";

  updateFormActionButtons(result.status);

  return true;
}


// ======================================================
// LOAD LIVE PRIORITY NUMBER
// ======================================================

async function loadPriority() {

  const priorityEl =
    document.getElementById("priorityRank");

  if (!priorityEl) {
    return;
  }

  try {

    const result =
      await API.priority(session.studentId);

    if (result.priorityRank) {

      priorityEl.textContent =
        result.totalInBatch
          ? `#${result.priorityRank}`
          : `#${result.priorityRank}`;

    } else {

      priorityEl.textContent = "—";
    }

  } catch (err) {

    priorityEl.textContent = "—";
  }
}


// ======================================================
// LOAD ALLOCATION RESULT
// ======================================================

async function loadResult() {

  // First check whether the hostel form has been submitted
  const profileComplete = await loadProfile();

  const profileCard =
    document.getElementById("profileCard");

  const submittedNotice =
    document.getElementById("profileSubmittedNotice");

  const notice =
    document.getElementById("notPublished");

  const resultCard =
    document.getElementById("resultCard");


  // ====================================================
  // HOSTEL FORM NOT SUBMITTED
  // ====================================================

  if (!profileComplete) {

    const formLockedNotice =
      document.getElementById("formLockedNotice");

    if (formLockState.formSubmissionLocked) {

      profileCard.classList.add("hidden");

      if (formLockedNotice) {
        formLockedNotice.classList.remove("hidden");
      }

    } else {

      profileCard.classList.remove("hidden");

      if (formLockedNotice) {
        formLockedNotice.classList.add("hidden");
      }
    }

    submittedNotice.classList.add("hidden");

    notice.classList.add("hidden");

    resultCard.classList.add("hidden");

    const cancelAllocBtn =
      document.getElementById("cancelAllocationBtn");

    if (cancelAllocBtn) {
      cancelAllocBtn.classList.add("hidden");
    }

    return;
  }


  // ====================================================
  // HOSTEL FORM SUBMITTED
  // ====================================================

  profileCard.classList.add("hidden");

  submittedNotice.classList.remove("hidden");

  await loadPriority();


  // ====================================================
  // CHECK ALLOCATION RESULT
  // ====================================================

  try {

    const result =
      await API.result(session.studentId);


    // ================================================
    // RESULT NOT PUBLISHED
    // ================================================

    if (!result.published) {

      notice.classList.remove("hidden");

      resultCard.classList.add("hidden");

      const cancelAllocBtn =
        document.getElementById("cancelAllocationBtn");

      if (cancelAllocBtn) {
        cancelAllocBtn.classList.add("hidden");
      }

      notice.querySelector("strong").textContent =
        "Allocation results are not published yet.";

      notice.querySelector("p").textContent =
        "Your hostel application has been successfully recorded. Please check back after the administrator publishes the results.";

      document.getElementById(
        "applicationStatus"
      ).textContent =
        session.status || "Submitted";

      return;
    }


    // ================================================
    // RESULT PUBLISHED
    // ================================================

    notice.classList.add("hidden");

    resultCard.classList.remove("hidden");

    const resultRemarkEl =
      document.getElementById("resultRemark");

    if (resultRemarkEl) {
      resultRemarkEl.textContent =
        result.remark && String(result.remark).trim()
          ? result.remark
          : "Welcome to your new campus home.";
    }


    document.getElementById("hostelName").textContent =
      result.hostelName ||
      result.hostelId ||
      "Not allocated";


    document.getElementById("hostelId").textContent =
      result.hostelId || "—";


    document.getElementById("roomId").textContent =
      result.roomId || "—";


    document.getElementById("resultStatus").textContent =
      result.status || "—";


    document.getElementById(
      "applicationStatus"
    ).textContent =
      result.status || "—";

    const cancelAllocBtn =
      document.getElementById("cancelAllocationBtn");

    if (cancelAllocBtn) {
      cancelAllocBtn.classList.toggle(
        "hidden",
        result.status !== "Allocated"
      );
    }

  } catch (err) {

    notice.classList.remove("hidden");

    resultCard.classList.add("hidden");

    notice.querySelector("strong").textContent =
      "Unable to load your result.";

    notice.querySelector("p").textContent =
      err.message;
  }
}


// ======================================================
// HOSTEL / PROFILE FORM SUBMISSION
// ======================================================

document
  .getElementById("profileForm")
  .addEventListener("submit", async e => {

    e.preventDefault();

    const form = e.currentTarget;

    const button =
      form.querySelector("button");

    const message =
      document.getElementById("profileMessage");


    message.className = "form-message";
    message.textContent = "";


    // ================================================
    // VALIDATE PIN
    // ================================================

    const pin =
      document.getElementById("pPin")
        .value
        .trim();


    if (!/^\d{6}$/.test(pin)) {

      message.textContent =
        "PIN code must contain exactly 6 digits.";

      return;
    }


    // ================================================
    // SUBMIT FORM
    // ================================================

    try {

      setLoading(
        button,
        true,
        "Submitting..."
      );


      const apiCall =
        editingMode
          ? API.editProfile
          : API.completeProfile;

      const result =
        await apiCall({

          studentId:
            session.studentId,

          name:
            document
              .getElementById("pName")
              .value
              .trim(),

          email:
            document
              .getElementById("pEmail")
              .value
              .trim(),

          course:
            document
              .getElementById("pCourse")
              .value
              .trim(),

          gender:
            document
              .getElementById("pGender")
              .value,

          pwd:
            document
              .getElementById("pPwd")
              .value,

          year:
            document
              .getElementById("pYear")
              .value,

          hostelPreference:
            document
              .getElementById("pPreference")
              .value
              .trim(),

          housePincode:
            pin,

          state:
            document
              .getElementById("pState")
              .value
              .trim()
        });

      const wasEditing =
        editingMode;

      editingMode = false;


      // ==============================================
      // BACKEND CONFIRMED SUBMISSION
      // ==============================================

      if (
        result.alreadySubmitted === true ||
        result.profileComplete === true
      ) {

        message.className =
          "form-message success";

        message.textContent =
          wasEditing
            ? "Hostel form updated successfully."
            : "Hostel form submitted successfully. The form is now locked.";

        // Update local session
        session.profileComplete = true;

        session.status =
          result.status || "Submitted";

        sessionStorage.setItem(
          "studentSession",
          JSON.stringify(session)
        );


        // Immediately hide form and show announcement
        document
          .getElementById("profileCard")
          .classList.add("hidden");

        document
          .getElementById("profileSubmittedNotice")
          .classList.remove("hidden");

        document
          .getElementById("applicationStatus")
          .textContent =
          result.status || "Submitted";


        // Load allocation/result status
        await loadResult();

      } else {

        message.className =
          "form-message success";

        message.textContent =
          result.message ||
          "Hostel form submitted successfully.";

        await loadResult();
      }


    } catch (err) {

      message.className =
        "form-message";

      message.textContent =
        err.message;


    } finally {

      setLoading(
        button,
        false
      );
    }
  });


// ======================================================
// EDIT FORM BUTTON
// ======================================================

document
  .getElementById("editProfileBtn")
  .addEventListener("click", () => {

    if (formLockState.formEditLocked) {
      return;
    }

    editingMode = true;

    document
      .getElementById("profileSubmittedNotice")
      .classList.add("hidden");

    document
      .getElementById("profileCard")
      .classList.remove("hidden");

    const message =
      document.getElementById("profileMessage");

    message.className = "form-message";
    message.textContent =
      "Editing is only possible before allocation has been run.";
  });


// ======================================================
// CANCEL REGISTRATION BUTTON
// ======================================================

document
  .getElementById("cancelRegistrationBtn")
  .addEventListener("click", async e => {

    if (
      !confirm(
        "Cancel your hostel form? Your account will stay active, but you'll need to fill the form again."
      )
    ) {
      return;
    }

    const button = e.currentTarget;

    try {

      setLoading(
        button,
        true,
        "Cancelling..."
      );

      const result =
        await API.cancelRegistration(
          session.studentId
        );

      sessionStorage.removeItem(
        "studentSession"
      );

      alert(
        result.message ||
        "Registration cancelled."
      );

      window.location.href =
        "index.html";

    } catch (err) {

      alert(err.message);

    } finally {

      setLoading(
        button,
        false
      );
    }
  });


// ======================================================
// CANCEL ALLOCATION BUTTON (inside the green result card)
// ======================================================

document
  .getElementById("cancelAllocationBtn")
  .addEventListener("click", async e => {

    if (
      !confirm(
        "Cancel your room allocation? Your room will be freed up for other students, and your status will change to Not Allocated."
      )
    ) {
      return;
    }

    const button = e.currentTarget;

    try {

      setLoading(
        button,
        true,
        "Cancelling..."
      );

      const result =
        await API.cancelAllocation(
          session.studentId
        );

      session.status =
        result.status || "Not Allocated";

      sessionStorage.setItem(
        "studentSession",
        JSON.stringify(session)
      );

      alert(
        result.message ||
        "Allocation cancelled."
      );

      await loadResult();

    } catch (err) {

      alert(err.message);

    } finally {

      setLoading(
        button,
        false
      );
    }
  });


// ======================================================
// REFRESH BUTTON
// ======================================================

document
  .getElementById("refreshBtn")
  .addEventListener("click", async () => {

    const button =
      document.getElementById("refreshBtn");

    try {

      setLoading(
        button,
        true,
        "Refreshing..."
      );

      await loadFormLockStatus();

      await loadResult();

    } catch (err) {

      const message =
        document.getElementById(
          "profileMessage"
        );

      message.className =
        "form-message";

      message.textContent =
        err.message;

    } finally {

      setLoading(
        button,
        false
      );
    }
  });


// ======================================================
// LOGOUT
// ======================================================

document
  .getElementById("logoutBtn")
  .addEventListener("click", () => {

    sessionStorage.removeItem(
      "studentSession"
    );

    window.location.href =
      "index.html";
  });


// ======================================================
// INITIALIZE STUDENT PORTAL
// ======================================================

async function initializeStudentPortal() {

  const pageLoader = showPageLoader();

  const dashboardStudentId =
    document.getElementById(
      "dashboardStudentId"
    );

  if (dashboardStudentId) {

    dashboardStudentId.textContent =
      session.studentId;
  }


  setUserHeader(
    session.name || "Student"
  );


  try {

    await loadFormLockStatus();

    await loadResult();

  } catch (err) {

    const notice =
      document.getElementById(
        "notPublished"
      );

    notice.classList.remove(
      "hidden"
    );

    notice.querySelector(
      "strong"
    ).textContent =
      "Unable to load your profile.";

    notice.querySelector(
      "p"
    ).textContent =
      err.message;

  } finally {

    await pageLoader.finish();
  }
}
// ======================================================
// GENDER → HOSTEL PREFERENCE
// ======================================================

const genderSelect = document.getElementById("pGender");
const hostelPreference = document.getElementById("pPreference");

function updateHostelPreferences() {
  if (!genderSelect || !hostelPreference) {
    return;
  }

  const gender = genderSelect.value;

  // Clear existing options
  hostelPreference.innerHTML = "";

  // No gender selected
  if (!gender) {
    hostelPreference.disabled = true;

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Select gender first";
    hostelPreference.appendChild(option);

    return;
  }

  // Enable hostel preference
  hostelPreference.disabled = false;

  // Default option
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select hostel";
  hostelPreference.appendChild(defaultOption);

  // Male → H01, H02
  if (gender === "Male") {
    ["H01", "H02"].forEach(hostel => {
      const option = document.createElement("option");
      option.value = hostel;
      option.textContent = hostel;
      hostelPreference.appendChild(option);
    });
  }

   // Female → H03, H04
  else if (gender === "Female") {
    ["H03", "H04"].forEach(hostel => {
      const option = document.createElement("option");
      option.value = hostel;
      option.textContent = hostel;
      hostelPreference.appendChild(option);
    });
  }
}

// Update hostel options whenever gender changes
if (genderSelect) {
  genderSelect.addEventListener("change", updateHostelPreferences);
}

// Initialize on page load
updateHostelPreferences();
