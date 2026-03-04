import type { FastifyInstance } from "fastify";

const CHATBOT_BUNDLE_JS = `(function () {
  var rootId = "wagenai-widget-root";
  var styleId = "wagenai-widget-style";
  var booted = false;

  var scriptTag = document.currentScript;
  if (!scriptTag) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      var candidate = scripts[i];
      var src = candidate.getAttribute("src") || "";
      if (/chatbot\\.bundle\\.js(?:\\?|$)/i.test(src)) {
        scriptTag = candidate;
        break;
      }
    }
  }
  if (!scriptTag) return;

  var workspaceId = (scriptTag.getAttribute("wid") || "").trim();
  if (!workspaceId) {
    console.warn("[WAgen SDK] Missing wid attribute.");
    return;
  }

  var theme = (scriptTag.getAttribute("data-theme-color") || "#1a2b48").trim();
  var position = ((scriptTag.getAttribute("data-position") || "right").trim().toLowerCase() === "left") ? "left" : "right";
  var greeting = (scriptTag.getAttribute("data-greeting") || "Hi there, how can we help you?").trim();
  var apiBaseAttr = (scriptTag.getAttribute("data-api-base") || "").trim();
  var apiBase = "";
  try {
    apiBase = apiBaseAttr || (new URL(scriptTag.src, window.location.href)).origin;
  } catch {
    apiBase = apiBaseAttr || window.location.origin;
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      var globalStore = window.__wagenaiVisitorStore || (window.__wagenaiVisitorStore = {});
      return globalStore[key] || "";
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      var globalStore = window.__wagenaiVisitorStore || (window.__wagenaiVisitorStore = {});
      globalStore[key] = value;
    }
  }

  function normalizeName(value) {
    return String(value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  }

  function normalizePhone(value) {
    var digits = String(value || "").replace(/\\D/g, "");
    if (digits.length < 8 || digits.length > 15) return "";
    return digits;
  }

  function normalizeEmail(value) {
    var email = String(value || "").trim().toLowerCase();
    if (!email) return "";
    return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) ? email.slice(0, 160) : "";
  }

  var visitorId = "";
  var visitorKey = "wagenai_vid_" + workspaceId;
  visitorId = safeGet(visitorKey);
  if (!visitorId) {
    visitorId = "vid_" + Math.random().toString(36).slice(2, 12);
    safeSet(visitorKey, visitorId);
  }

  var profileKey = "wagenai_profile_" + workspaceId;
  var leadProfile = { name: "", phone: "", email: "" };
  var rawProfile = safeGet(profileKey);
  if (rawProfile) {
    try {
      var parsedProfile = JSON.parse(rawProfile);
      leadProfile = {
        name: normalizeName(parsedProfile.name),
        phone: normalizePhone(parsedProfile.phone),
        email: normalizeEmail(parsedProfile.email)
      };
    } catch {}
  }

  var wsBase = apiBase.replace(/^http/i, "ws").replace(/\\/$/, "");
  var wsUrl = wsBase + "/ws/widget?wid=" + encodeURIComponent(workspaceId) + "&visitorId=" + encodeURIComponent(visitorId);
  var notificationTitle = (scriptTag.getAttribute("data-notification-title") || document.title || "New message").trim();
  var webAudioContext = null;
  var notificationPermissionRequested = false;

  function requestNotificationPermission() {
    if (notificationPermissionRequested) return;
    notificationPermissionRequested = true;
    if (!("Notification" in window)) return;
    if (window.Notification.permission !== "default") return;
    try {
      window.Notification.requestPermission().catch(function () {});
    } catch {}
  }

  function playIncomingMessageSound() {
    var ContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!ContextCtor) return;
    if (!webAudioContext) {
      try {
        webAudioContext = new ContextCtor();
      } catch {
        return;
      }
    }
    if (!webAudioContext) return;

    if (webAudioContext.state !== "running" && typeof webAudioContext.resume === "function") {
      webAudioContext.resume().catch(function () {});
    }
    if (webAudioContext.state !== "running") return;

    var now = webAudioContext.currentTime;
    var oscillator = webAudioContext.createOscillator();
    var gainNode = webAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(920, now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gainNode);
    gainNode.connect(webAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  function showIncomingBrowserNotification(text) {
    if (!("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;
    try {
      var body = String(text || "").slice(0, 180);
      var popup = new window.Notification(notificationTitle || "New message", {
        body: body,
        tag: "wagenai-widget-" + workspaceId
      });
      setTimeout(function () {
        try {
          popup.close();
        } catch {}
      }, 6000);
    } catch {}
  }

  function triggerIncomingAlert(text) {
    playIncomingMessageSound();
    showIncomingBrowserNotification(text);
  }

  function boot() {
    if (booted) return;
    if (!document.body) return;
    if (document.getElementById(rootId)) {
      booted = true;
      return;
    }
    booted = true;

    if (!document.getElementById(styleId)) {
      var style = document.createElement("style");
      style.id = styleId;
      style.textContent =
        "#wagenai-widget-root{position:fixed;z-index:2147483647;bottom:16px;" + (position === "right" ? "right" : "left") + ":16px;font-family:Arial,sans-serif}" +
        ".wagenai-fab{width:56px;height:56px;border-radius:999px;border:0;cursor:pointer;background:" + theme + ";color:#fff;font-size:22px;box-shadow:0 10px 24px rgba(0,0,0,.2)}" +
        ".wagenai-panel{width:320px;max-width:calc(100vw - 24px);border:1px solid #d4dbe7;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 14px 36px rgba(0,0,0,.2);margin-bottom:10px;display:none}" +
        ".wagenai-panel.open{display:block}" +
        ".wagenai-head{background:" + theme + ";color:#fff;padding:12px}" +
        ".wagenai-head strong{display:block;font-size:15px}" +
        ".wagenai-profile{padding:12px;display:grid;gap:8px;border-bottom:1px solid #e5ebf5;background:#fff}" +
        ".wagenai-profile.hidden{display:none}" +
        ".wagenai-profile-note{font-size:12px;color:#42526b}" +
        ".wagenai-profile-error{font-size:12px;color:#c1272d;min-height:14px}" +
        ".wagenai-field{width:100%;border:1px solid #ccd4e2;border-radius:9px;padding:10px;font-size:14px;box-sizing:border-box}" +
        ".wagenai-start{border:0;border-radius:9px;padding:10px 12px;background:" + theme + ";color:#fff;font-weight:700;cursor:pointer}" +
        ".wagenai-thread{padding:12px;background:#ece8e3;max-height:280px;overflow:auto;display:grid;gap:8px}" +
        ".wagenai-thread.hidden{display:none}" +
        ".wagenai-msg{background:#fff;border-radius:10px;padding:10px;font-size:14px;line-height:1.35;max-width:88%}" +
        ".wagenai-msg.user{justify-self:end;background:#dcf8c6}" +
        ".wagenai-row{display:flex;gap:8px;padding:10px;border-top:1px solid #dfe6f1;background:#fff}" +
        ".wagenai-row.hidden{display:none}" +
        ".wagenai-row input{flex:1;border:1px solid #ccd4e2;border-radius:9px;padding:10px;font-size:14px}" +
        ".wagenai-row button{border:0;border-radius:9px;padding:10px 12px;background:" + theme + ";color:#fff;font-weight:700;cursor:pointer}";
      document.head.appendChild(style);
    }

    var root = document.createElement("div");
    root.id = rootId;
    root.innerHTML =
      "<div class='wagenai-panel' id='wagenai-panel'>" +
      "<div class='wagenai-head'><strong>Chat</strong></div>" +
      "<div class='wagenai-profile' id='wagenai-profile'>" +
      "<div class='wagenai-profile-note'>Please share your details before chat.</div>" +
      "<input id='wagenai-name' class='wagenai-field' placeholder='Your name' />" +
      "<input id='wagenai-phone' class='wagenai-field' placeholder='Phone number' />" +
      "<input id='wagenai-email' class='wagenai-field' placeholder='Email address' />" +
      "<div id='wagenai-profile-error' class='wagenai-profile-error'></div>" +
      "<button id='wagenai-start' class='wagenai-start'>Start chat</button>" +
      "</div>" +
      "<div class='wagenai-thread hidden' id='wagenai-thread'><div class='wagenai-msg'>" + greeting + "</div></div>" +
      "<div class='wagenai-row hidden' id='wagenai-row'><input id='wagenai-input' placeholder='Type your message'/><button id='wagenai-send'>Send</button></div>" +
      "</div>" +
      "<button id='wagenai-fab' class='wagenai-fab' aria-label='Open chat'>W</button>";
    document.body.appendChild(root);

    var socket = null;
    var pendingMessages = [];
    var pendingLeadProfile = null;
    var profileSubmitted = false;
    var panel = document.getElementById("wagenai-panel");
    var fab = document.getElementById("wagenai-fab");
    var profileWrap = document.getElementById("wagenai-profile");
    var profileError = document.getElementById("wagenai-profile-error");
    var nameInput = document.getElementById("wagenai-name");
    var phoneInput = document.getElementById("wagenai-phone");
    var emailInput = document.getElementById("wagenai-email");
    var startButton = document.getElementById("wagenai-start");
    var input = document.getElementById("wagenai-input");
    var send = document.getElementById("wagenai-send");
    var inputRow = document.getElementById("wagenai-row");
    var thread = document.getElementById("wagenai-thread");

    if (nameInput) nameInput.value = leadProfile.name;
    if (phoneInput) phoneInput.value = leadProfile.phone;
    if (emailInput) emailInput.value = leadProfile.email;

    var applyProfileState = function () {
      if (profileWrap) profileWrap.classList.toggle("hidden", profileSubmitted);
      if (thread) thread.classList.toggle("hidden", !profileSubmitted);
      if (inputRow) inputRow.classList.toggle("hidden", !profileSubmitted);
    };
    applyProfileState();

    var push = function (text, sender) {
      if (!thread || !text) return;
      var row = document.createElement("div");
      row.className = sender === "user" ? "wagenai-msg user" : "wagenai-msg";
      row.textContent = text;
      thread.appendChild(row);
      thread.scrollTop = thread.scrollHeight;
    };

    var flushPending = function () {
      if (!socket || socket.readyState !== 1 || pendingMessages.length === 0) return;
      for (var j = 0; j < pendingMessages.length; j += 1) {
        socket.send(JSON.stringify({
          type: "message",
          wid: workspaceId,
          visitorId: visitorId,
          name: leadProfile.name,
          phone: leadProfile.phone,
          email: leadProfile.email,
          message: pendingMessages[j]
        }));
      }
      pendingMessages = [];
    };

    var flushLeadProfile = function () {
      if (!pendingLeadProfile || !socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify({
        type: "lead_profile",
        wid: workspaceId,
        visitorId: visitorId,
        name: pendingLeadProfile.name,
        phone: pendingLeadProfile.phone,
        email: pendingLeadProfile.email
      }));
      pendingLeadProfile = null;
    };

    var connect = function () {
      if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = function () {
        flushLeadProfile();
        flushPending();
      };
      socket.onmessage = function (event) {
        try {
          var payload = JSON.parse(event.data || "{}");
          if (payload && payload.event === "message" && payload.data && payload.data.text) {
            var messageText = String(payload.data.text);
            push(messageText, "ai");
            triggerIncomingAlert(messageText);
          }
        } catch {}
      };
      socket.onerror = function () {
        push("Connection issue. Please try again.", "ai");
      };
    };

    var sendMessage = function () {
      requestNotificationPermission();
      if (!profileSubmitted) {
        if (profileError) profileError.textContent = "Please submit name, phone, and email first.";
        return;
      }
      var text = (input && input.value ? input.value.trim() : "");
      if (!text) return;
      push(text, "user");
      if (input) input.value = "";
      connect();
      if (!socket || socket.readyState !== 1) {
        pendingMessages.push(text);
        return;
      }
      socket.send(JSON.stringify({
        type: "message",
        wid: workspaceId,
        visitorId: visitorId,
        message: text
      }));
    };

    var startChat = function () {
      requestNotificationPermission();
      var nextProfile = {
        name: normalizeName(nameInput && nameInput.value),
        phone: normalizePhone(phoneInput && phoneInput.value),
        email: normalizeEmail(emailInput && emailInput.value)
      };

      if (!nextProfile.name || !nextProfile.phone || !nextProfile.email) {
        if (profileError) profileError.textContent = "Enter valid name, phone (8-15 digits), and email.";
        return;
      }

      if (profileError) profileError.textContent = "";
      leadProfile = nextProfile;
      safeSet(profileKey, JSON.stringify(leadProfile));
      pendingLeadProfile = nextProfile;
      profileSubmitted = true;
      applyProfileState();
      connect();
      if (input) input.focus();
      if (thread) thread.scrollTop = thread.scrollHeight;
    };

    if (fab) {
      fab.addEventListener("click", function () {
        if (!panel) return;
        panel.classList.toggle("open");
        if (panel.classList.contains("open")) {
          requestNotificationPermission();
          if (profileSubmitted) {
            connect();
          } else if (nameInput) {
            nameInput.focus();
          }
          if (thread) thread.scrollTop = thread.scrollHeight;
        }
      });
    }
    if (startButton) startButton.addEventListener("click", startChat);
    if (emailInput) {
      emailInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") startChat();
      });
    }
    if (send) send.addEventListener("click", sendMessage);
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") sendMessage();
      });
    }
  }

  if (document.readyState === "loading" || !document.body) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    window.addEventListener("load", boot, { once: true });
    setTimeout(boot, 0);
  } else {
    boot();
  }
})();`;

export async function sdkRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/sdk/chatbot.bundle.js", async (_, reply) => {
    reply.type("application/javascript; charset=utf-8");
    return CHATBOT_BUNDLE_JS;
  });
}
