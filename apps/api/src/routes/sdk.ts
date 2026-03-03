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

  var visitorId = "";
  var visitorKey = "wagenai_vid_" + workspaceId;
  try {
    visitorId = localStorage.getItem(visitorKey) || "";
    if (!visitorId) {
      visitorId = "vid_" + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(visitorKey, visitorId);
    }
  } catch {
    var globalStore = window.__wagenaiVisitorStore || (window.__wagenaiVisitorStore = {});
    visitorId = globalStore[visitorKey] || "";
    if (!visitorId) {
      visitorId = "vid_" + Math.random().toString(36).slice(2, 12);
      globalStore[visitorKey] = visitorId;
    }
  }

  var wsBase = apiBase.replace(/^http/i, "ws").replace(/\\/$/, "");
  var wsUrl = wsBase + "/ws/widget?wid=" + encodeURIComponent(workspaceId) + "&visitorId=" + encodeURIComponent(visitorId);

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
        ".wagenai-thread{padding:12px;background:#ece8e3;max-height:280px;overflow:auto;display:grid;gap:8px}" +
        ".wagenai-msg{background:#fff;border-radius:10px;padding:10px;font-size:14px;line-height:1.35;max-width:88%}" +
        ".wagenai-msg.user{justify-self:end;background:#dcf8c6}" +
        ".wagenai-row{display:flex;gap:8px;padding:10px;border-top:1px solid #dfe6f1;background:#fff}" +
        ".wagenai-row input{flex:1;border:1px solid #ccd4e2;border-radius:9px;padding:10px;font-size:14px}" +
        ".wagenai-row button{border:0;border-radius:9px;padding:10px 12px;background:" + theme + ";color:#fff;font-weight:700;cursor:pointer}";
      document.head.appendChild(style);
    }

    var root = document.createElement("div");
    root.id = rootId;
    root.innerHTML =
      "<div class='wagenai-panel' id='wagenai-panel'>" +
      "<div class='wagenai-head'><strong>Chat</strong></div>" +
      "<div class='wagenai-thread' id='wagenai-thread'><div class='wagenai-msg'>" + greeting + "</div></div>" +
      "<div class='wagenai-row'><input id='wagenai-input' placeholder='Type your message'/><button id='wagenai-send'>Send</button></div>" +
      "</div>" +
      "<button id='wagenai-fab' class='wagenai-fab' aria-label='Open chat'>W</button>";
    document.body.appendChild(root);

    var socket = null;
    var pendingMessages = [];
    var panel = document.getElementById("wagenai-panel");
    var fab = document.getElementById("wagenai-fab");
    var input = document.getElementById("wagenai-input");
    var send = document.getElementById("wagenai-send");
    var thread = document.getElementById("wagenai-thread");

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
          message: pendingMessages[j]
        }));
      }
      pendingMessages = [];
    };

    var connect = function () {
      if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = function () {
        flushPending();
      };
      socket.onmessage = function (event) {
        try {
          var payload = JSON.parse(event.data || "{}");
          if (payload && payload.event === "message" && payload.data && payload.data.text) {
            push(String(payload.data.text), "ai");
          }
        } catch {}
      };
      socket.onerror = function () {
        push("Connection issue. Please try again.", "ai");
      };
    };

    var sendMessage = function () {
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

    if (fab) {
      fab.addEventListener("click", function () {
        if (!panel) return;
        panel.classList.toggle("open");
        if (panel.classList.contains("open")) {
          connect();
          if (thread) thread.scrollTop = thread.scrollHeight;
        }
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
