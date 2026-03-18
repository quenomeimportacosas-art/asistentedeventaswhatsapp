// Sales Copilot — Content Script
// Lee el DOM de WhatsApp Web y extrae la conversación activa

(function () {
  "use strict";

  let lastChatName = "";
  let observer = null;

  // ============================================================
  // EXTRACTOR DE CONVERSACIÓN
  // ============================================================

  function extractConversation() {
    const messages = [];

    // Nombre del chat activo
    const chatNameEl =
      document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
      document.querySelector("header [title]") ||
      document.querySelector("._21S-L span");
    const chatName = chatNameEl ? chatNameEl.textContent.trim() : "Contacto desconocido";

    // Contenedor de mensajes
    const messageRows = document.querySelectorAll(
      '[data-testid="msg-container"], .message-in, .message-out, [class*="message-"]'
    );

    if (messageRows.length === 0) {
      // Selector alternativo más amplio
      const fallback = document.querySelectorAll('[role="row"]');
      fallback.forEach((row) => {
        const textEl = row.querySelector('[data-testid="msg-text"]') ||
          row.querySelector("span.selectable-text");
        if (!textEl) return;
        const isOutgoing = row.querySelector('[data-testid="msg-dblcheck"]') ||
          row.querySelector('[data-icon="msg-dblcheck"]') ||
          row.querySelector('[data-icon="msg-check"]');
        messages.push({
          role: isOutgoing ? "vendedor" : "cliente",
          text: textEl.textContent.trim(),
          time: extractTime(row)
        });
      });
    } else {
      messageRows.forEach((row) => {
        const textEl =
          row.querySelector('[data-testid="msg-text"]') ||
          row.querySelector("span.selectable-text") ||
          row.querySelector(".copyable-text span");
        if (!textEl || !textEl.textContent.trim()) return;

        const isOutgoing =
          row.classList.contains("message-out") ||
          row.closest(".message-out") !== null;

        messages.push({
          role: isOutgoing ? "vendedor" : "cliente",
          text: textEl.textContent.trim(),
          time: extractTime(row)
        });
      });
    }

    return { chatName, messages };
  }

  function extractTime(row) {
    const timeEl = row.querySelector('[data-testid="msg-meta"] span') ||
      row.querySelector("._4dj57 span") ||
      row.querySelector(".copyable-text");
    if (timeEl) {
      const dt = timeEl.getAttribute("data-pre-plain-text");
      if (dt) {
        const match = dt.match(/\[(\d{1,2}:\d{2})/);
        return match ? match[1] : "";
      }
      return timeEl.textContent.trim().slice(0, 5);
    }
    return "";
  }

  function formatConversation(messages) {
    if (messages.length === 0) return "No se encontraron mensajes en este chat.";
    // Últimos 30 mensajes para no inflar el prompt
    const recent = messages.slice(-30);
    return recent.map(m =>
      `[${m.time || "?"}] ${m.role === "vendedor" ? "VENDEDOR" : "CLIENTE"}: ${m.text}`
    ).join("\n");
  }

  // ============================================================
  // LISTENER DE MENSAJES DESDE EL PANEL
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_CHAT") {
      try {
        const { chatName, messages } = extractConversation();
        const formatted = formatConversation(messages);
        sendResponse({
          success: true,
          chatName,
          conversation: formatted,
          messageCount: messages.length
        });
      } catch (e) {
        sendResponse({
          success: false,
          error: "No se pudo leer el chat: " + e.message
        });
      }
      return true;
    }

    if (message.type === "PING") {
      sendResponse({ success: true, status: "ready" });
      return true;
    }
  });

  // ============================================================
  // OBSERVER — detecta cambio de chat
  // ============================================================

  function setupObserver() {
    if (observer) observer.disconnect();

    const target = document.querySelector("#main") || document.body;
    observer = new MutationObserver(() => {
      const chatNameEl =
        document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
        document.querySelector("header [title]");
      if (chatNameEl) {
        const name = chatNameEl.textContent.trim();
        if (name !== lastChatName) {
          lastChatName = name;
          chrome.runtime.sendMessage({
            type: "CHAT_CHANGED",
            chatName: name
          }).catch(() => {}); // Panel puede no estar abierto
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  // Esperar a que WhatsApp cargue
  const waitForWA = setInterval(() => {
    if (document.querySelector("#app") || document.querySelector('[data-testid="chat-list"]')) {
      clearInterval(waitForWA);
      setupObserver();
      console.log("✅ Sales Copilot: content script listo");
    }
  }, 1000);

})();
