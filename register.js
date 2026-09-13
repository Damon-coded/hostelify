const form = document.getElementById("registerForm");

form.addEventListener("submit", async e => {
  e.preventDefault();

  const message = document.getElementById("registerMessage");
  const button = form.querySelector("button");
  const studentId = document.getElementById("rStudentId").value.trim();
  const password = document.getElementById("rPassword").value;
  const confirm = document.getElementById("rConfirm").value;

  message.className = "form-message";
  message.textContent = "";

  if (password !== confirm) {
    message.textContent = "Passwords do not match.";
    return;
  }

  if (password.length < 6) {
    message.textContent = "Password must be at least 6 characters long.";
    return;
  }

  try {
    setLoading(button, true, "Creating...");

    const result = await API.register({ studentId, password });

    message.className = "form-message success";
    message.textContent = "Account created successfully. Redirecting to login...";
    form.reset();

    setTimeout(() => {
      window.location.href = "index.html#login";
    }, 1200);
  } catch (err) {
    message.textContent = err.message;
  } finally {
    setLoading(button, false);
  }
});