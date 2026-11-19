/* ==========================================================================
   Fluency Standard Enrollment Funnel - Client-Side Interactions
   Zero dependencies, strict-CSP safe (no inline handlers or inline styles).
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     1. PROGRAM CATALOG (Client-side display only)
     BACKEND: Keep slugs synced with the server. The server must always look
     up the authoritative price from the program slug and ignore client prices.
     ------------------------------------------------------------------------ */
  const PROGRAMS = {
    "program-1": {
      slug: "program-1",
      name: "[PROGRAM 1 NAME]",
      price: "[PROGRAM 1 PRICE]"
    },
    "program-2": {
      slug: "program-2",
      name: "[PROGRAM 2 NAME]",
      price: "[PROGRAM 2 PRICE]"
    }
  };

  const DEFAULT_PROGRAM_SLUG = "program-1";
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const BD_WHATSAPP_PATTERN = /^(?:\+?88)?01[3-9]\d{8}$/;

  /* ------------------------------------------------------------------------
     2. VIDEO FACADE (index.html)
     Loads the actual <video> or <iframe> only when the visitor clicks play.
     ------------------------------------------------------------------------ */
  function initVideoFacade() {
    const facade = document.querySelector("[data-video-facade]");
    const playBtn = document.querySelector("[data-video-play]");
    if (!facade || !playBtn) {
      return;
    }

    playBtn.addEventListener("click", function () {
      const src = (facade.getAttribute("data-video-src") || "").trim();
      const type = (facade.getAttribute("data-video-type") || "mp4").trim().toLowerCase();
      const title = facade.getAttribute("data-video-title") || "Course introduction video";

      if (!src || src.startsWith("[")) {
        // Placeholder safeguard during local front-end review
        playBtn.setAttribute("aria-label", "Video source placeholder not configured yet");
        return;
      }

      let player;

      if (type === "embed") {
        player = document.createElement("iframe");
        player.className = "video-player";
        player.src = src;
        player.title = title;
        player.allow = "autoplay; fullscreen; picture-in-picture";
        player.allowFullscreen = true;
        player.referrerPolicy = "strict-origin-when-cross-origin";
      } else {
        player = document.createElement("video");
        player.className = "video-player";
        player.controls = true;
        player.autoplay = true;
        player.playsInline = true;
        player.preload = "metadata";

        const source = document.createElement("source");
        source.src = src;
        source.type = "video/mp4";
        player.appendChild(source);
      }

      facade.textContent = "";
      facade.appendChild(player);
      player.focus();
    });
  }

  /* ------------------------------------------------------------------------
     3. PROGRAM SELECTION FROM QUERY STRING (enroll.html)
     ------------------------------------------------------------------------ */
  function initProgramContext() {
    const programInput = document.getElementById("program-input");
    if (!programInput) {
      return null;
    }

    const params = new URLSearchParams(window.location.search);
    const requested = (params.get("program") || "").trim().toLowerCase();
    const isValid = Object.prototype.hasOwnProperty.call(PROGRAMS, requested);
    const selected = isValid ? PROGRAMS[requested] : PROGRAMS[DEFAULT_PROGRAM_SLUG];

    programInput.value = selected.slug;

    const fallbackNote = document.querySelector("[data-program-fallback]");
    if (fallbackNote) {
      fallbackNote.hidden = isValid;
    }

    setText("[data-program-name]", selected.name);
    setText("[data-program-price]", selected.price);
    setText("[data-payment-amount]", selected.price);
    setText("[data-bar-program]", selected.name);
    setText("[data-bar-price]", selected.price);
    setText("[data-confirm-program]", selected.name);

    return selected;
  }

  function setText(selector, value) {
    const el = document.querySelector(selector);
    if (el) {
      el.textContent = value;
    }
  }

  /* ------------------------------------------------------------------------
     4. COPY PAYMENT NUMBER WITH CLIPBOARD FALLBACK (enroll.html)
     ------------------------------------------------------------------------ */
  function initCopyButton() {
    const copyBtn = document.querySelector("[data-copy-btn]");
    const copySource = document.querySelector("[data-copy-source]");
    const copyLabel = document.querySelector("[data-copy-label]");
    const copyStatus = document.getElementById("copy-status");

    if (!copyBtn || !copySource || !copyLabel) {
      return;
    }

    let resetTimer = null;

    function showCopiedFeedback() {
      copyBtn.classList.add("is-copied");
      copyLabel.textContent = "Copied";
      if (copyStatus) {
        copyStatus.textContent = "Payment number copied to clipboard.";
      }

      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }

      resetTimer = window.setTimeout(function () {
        copyBtn.classList.remove("is-copied");
        copyLabel.textContent = "Copy number";
        if (copyStatus) {
          copyStatus.textContent = "";
        }
      }, 2000);
    }

    function fallbackCopy(text) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.className = "sr-only";
      document.body.appendChild(textarea);
      textarea.select();

      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (_err) {
        copied = false;
      }

      document.body.removeChild(textarea);
      return copied;
    }

    copyBtn.addEventListener("click", function () {
      const numberText = copySource.textContent.trim();
      if (!numberText) {
        return;
      }

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(numberText).then(
          showCopiedFeedback,
          function () {
            if (fallbackCopy(numberText)) {
              showCopiedFeedback();
            }
          }
        );
      } else if (fallbackCopy(numberText)) {
        showCopiedFeedback();
      }
    });
  }

  /* ------------------------------------------------------------------------
     5. ENROLLMENT FORM, FILE UPLOAD & VALIDATION (enroll.html)
     NOTE: Client-side validation is for UX only. The server MUST re-validate
     every input field, the CSRF token, honeypot, and uploaded screenshot file.
     ------------------------------------------------------------------------ */
  function initEnrollmentForm() {
    const form = document.getElementById("enroll-form");
    if (!form) {
      return;
    }

    const submitBtn = document.getElementById("submit-btn");
    const submitLabel = form.querySelector("[data-submit-label]");
    const formError = document.getElementById("form-error");
    const confirmationState = document.getElementById("confirmation-state");

    const uploadZone = form.querySelector("[data-upload-zone]");
    const fileInput = document.getElementById("screenshot");
    const uploadPrompt = form.querySelector("[data-upload-prompt]");
    const uploadPreview = form.querySelector("[data-upload-preview]");
    const uploadThumb = form.querySelector("[data-upload-thumb]");
    const uploadName = form.querySelector("[data-upload-name]");
    const uploadSize = form.querySelector("[data-upload-size]");
    const removeBtn = form.querySelector("[data-upload-remove]");

    let activeFile = null;
    let previewObjectUrl = null;
    let isSubmitting = false;

    const textInputs = Array.from(
      form.querySelectorAll("input:not([type='hidden']):not([type='file']):not([name='website']), select")
    );

    function formatFileSize(bytes) {
      if (bytes < 1024) {
        return bytes + " B";
      }
      if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(1) + " KB";
      }
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    }

    function setFieldError(field, message) {
      const errorEl = document.getElementById(field.id + "-error");
      if (message) {
        field.setAttribute("aria-invalid", "true");
        if (errorEl) {
          errorEl.textContent = message;
        }
      } else {
        field.removeAttribute("aria-invalid");
        if (errorEl) {
          errorEl.textContent = "";
        }
      }
    }

    function getValidationMessage(field) {
      const value = field.value.trim();

      if (field.required && !value) {
        return "This field is required.";
      }

      if (field.id === "whatsapp" && value) {
        const normalized = value.replace(/[\s-]/g, "");
        if (!BD_WHATSAPP_PATTERN.test(normalized)) {
          return "Enter a valid Bangladesh number starting with 01 (11 digits).";
        }
      }

      if (field.type === "email" && value && field.validity.typeMismatch) {
        return "Enter a valid email address.";
      }

      return "";
    }

    function validateField(field, showMessage) {
      const message = getValidationMessage(field);
      if (showMessage) {
        setFieldError(field, message);
      }
      return message === "";
    }

    function clearScreenshot(keepError) {
      activeFile = null;
      fileInput.value = "";

      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      }

      uploadThumb.src = "";
      uploadName.textContent = "";
      uploadSize.textContent = "";
      uploadPreview.hidden = true;
      uploadPrompt.hidden = false;

      if (!keepError) {
        uploadZone.classList.remove("has-error");
        setFieldError(fileInput, "");
      }

      updateSubmitState();
    }

    function handleSelectedFile(file) {
      if (!file) {
        return;
      }

      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        clearScreenshot(true);
        uploadZone.classList.add("has-error");
        setFieldError(fileInput, "Only JPG, PNG, or WEBP images are accepted.");
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        clearScreenshot(true);
        uploadZone.classList.add("has-error");
        setFieldError(fileInput, "File is larger than 5 MB. Please choose a smaller image.");
        return;
      }

      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }

      activeFile = file;
      previewObjectUrl = URL.createObjectURL(file);

      uploadThumb.src = previewObjectUrl;
      uploadName.textContent = file.name;
      uploadSize.textContent = formatFileSize(file.size);
      uploadPrompt.hidden = true;
      uploadPreview.hidden = false;
      uploadZone.classList.remove("has-error");
      setFieldError(fileInput, "");

      updateSubmitState();
    }

    function syncFileInput(file) {
      // Keeps native FormData in sync when a file is dropped rather than picked
      if (typeof DataTransfer === "undefined") {
        return;
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
    }

    function isFormReady() {
      const fieldsValid = textInputs.every(function (field) {
        return validateField(field, false);
      });
      return fieldsValid && activeFile !== null;
    }

    function updateSubmitState() {
      if (!submitBtn || isSubmitting) {
        return;
      }
      submitBtn.disabled = !isFormReady();
    }

    // Bind field validation listeners
    textInputs.forEach(function (field) {
      field.addEventListener("blur", function () {
        validateField(field, true);
        updateSubmitState();
      });

      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true") {
          validateField(field, true);
        }
        updateSubmitState();
      });

      if (field.tagName === "SELECT") {
        field.addEventListener("change", function () {
          validateField(field, true);
          updateSubmitState();
        });
      }
    });

    // Bind upload zone click, keyboard, and drag-and-drop
    uploadZone.addEventListener("click", function (event) {
      if (event.target.closest("[data-upload-remove]")) {
        return;
      }
      fileInput.click();
    });

    uploadZone.addEventListener("keydown", function (event) {
      if (event.target.closest("[data-upload-remove]")) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", function () {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        handleSelectedFile(file);
      }
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      uploadZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        uploadZone.classList.add("is-dragover");
      });
    });

    ["dragleave", "dragend", "drop"].forEach(function (eventName) {
      uploadZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        uploadZone.classList.remove("is-dragover");
      });
    });

    uploadZone.addEventListener("drop", function (event) {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) {
        return;
      }
      syncFileInput(file);
      handleSelectedFile(file);
    });

    removeBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      clearScreenshot(false);
      uploadZone.focus();
    });

    // Form submit handler
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (isSubmitting) {
        return;
      }

      formError.hidden = true;
      formError.textContent = "";

      let firstInvalid = null;

      textInputs.forEach(function (field) {
        const valid = validateField(field, true);
        if (!valid && !firstInvalid) {
          firstInvalid = field;
        }
      });

      if (!activeFile) {
        uploadZone.classList.add("has-error");
        setFieldError(fileInput, "Please upload your payment screenshot.");
        if (!firstInvalid) {
          firstInvalid = uploadZone;
        }
      }

      if (firstInvalid) {
        firstInvalid.focus();
        updateSubmitState();
        return;
      }

      // Normalize WhatsApp spacing before building FormData
      const whatsappField = document.getElementById("whatsapp");
      if (whatsappField) {
        whatsappField.value = whatsappField.value.trim().replace(/[\s-]/g, "");
      }

      isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.classList.add("is-loading");
      submitBtn.setAttribute("aria-busy", "true");
      if (submitLabel) {
        submitLabel.textContent = "Submitting...";
      }

      // BACKEND: Replace the simulated timeout below with a real fetch() request.
      // TODO: Connect to POST /api/enroll using FormData(form).
      // Example:
      //   const payload = new FormData(form);
      //   fetch(form.action, { method: "POST", body: payload, credentials: "same-origin" })
      //     .then((res) => { if (!res.ok) throw new Error("Submission failed"); return res.json(); })
      //     .then(() => showConfirmation())
      //     .catch(() => showSubmissionError("Something went wrong. Please try again."));

      window.setTimeout(function () {
        showConfirmation();
      }, 900);
    });

    function showConfirmation() {
      isSubmitting = false;
      form.hidden = true;
      confirmationState.hidden = false;
      confirmationState.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    updateSubmitState();
  }

  /* ------------------------------------------------------------------------
     6. BOOTSTRAP
     ------------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", function () {
    initVideoFacade();
    initProgramContext();
    initCopyButton();
    initEnrollmentForm();
  });
})();