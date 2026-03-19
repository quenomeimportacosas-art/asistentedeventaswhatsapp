// Sales Copilot — Panel JS v2.0
// Nuevo formato: 3 mensajes + análisis completo

(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  const chatNameEl    = $("chatName");
  const dotEl         = document.querySelector(".dot");
  const viewMain      = $("viewMain");
  const viewConfig    = $("viewConfig");
  const emptyState    = $("emptyState");
  const errorState    = $("errorState");
  const errorText     = $("errorText");
  const loadingState  = $("loadingState");
  const loadingText   = $("loadingText");
  const thermoSection = $("thermoSection");
  const thermoBadge   = $("thermoBadge");
  const thermoFill    = $("thermoFill");
  const thermoCursor  = $("thermoCursor");
  const thermoReason  = $("thermoReason");
  const momentRow     = $("momentRow");
  const momentTag     = $("momentTag");
  const suggSection   = $("suggestionSection");
  const suggText      = $("suggestionText");
  const tacticValue   = $("tacticValue");
  const goalValue     = $("goalValue");
  const reasoningValue= $("reasoningValue");
  const toneRow       = $("toneRow");
  const toneBtns      = $("toneBtns");
  const analyzeBtn    = $("analyzeBtn");
  const closedBtn     = $("closedBtn");
  const configBtn     = $("configBtn");
  const backBtn       = $("backBtn");
  const copyBtn       = $("copyBtn");
  const saveBtn       = $("saveBtn");
  const saveStatus    = $("saveStatus");
  const mainFooter    = $("mainFooter");
  const toast         = $("toast");

  let currentChatName = "";
  let currentSuggestion = null;
  let currentConversation = "";
  let isLoading = false;

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    await loadConfig();
    setupListeners();
    checkContentScript();
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "CHAT_CHANGED") {
        updateChatName(msg.chatName);
        resetResults();
      }
    });
  }

  // ============================================================
  // CONTENT SCRIPT — auto-inject
  // ============================================================

  async function checkContentScript() {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    if (!tabs[0] || !tabs[0].url?.includes("web.whatsapp.com")) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "PING" }, async (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ["src/content/content.js"] });
          setTimeout(() => pollChatName(tabs[0].id), 800);
        } catch (e) { console.warn("Inyección fallida:", e.message); }
      } else {
        pollChatName(tabs[0].id);
      }
    });
  }

  function pollChatName(tabId) {
    chrome.tabs.sendMessage(tabId, { type: "GET_CHAT" }, (response) => {
      if (response?.success && response.chatName) updateChatName(response.chatName);
    });
  }

  // ============================================================
  // CONFIG
  // ============================================================

  async function loadConfig() {
    const data = await chrome.storage.local.get([
      "groqApiKey", "openRouterApiKey",
      "bizName", "bizProducts", "bizPriceRange",
      "bizDelivery", "bizReturns", "bizTone", "bizObjections"
    ]);
    if (data.groqApiKey)       $("groqKey").value       = data.groqApiKey;
    if (data.openRouterApiKey) $("openRouterKey").value  = data.openRouterApiKey;
    if (data.bizName)          $("bizName").value        = data.bizName;
    if (data.bizProducts)      $("bizProducts").value    = data.bizProducts;
    if (data.bizPriceRange)    $("bizPriceRange").value  = data.bizPriceRange;
    if (data.bizDelivery)      $("bizDelivery").value    = data.bizDelivery;
    if (data.bizReturns)       $("bizReturns").value     = data.bizReturns;
    if (data.bizTone)          $("bizTone").value        = data.bizTone;
    if (data.bizObjections)    $("bizObjections").value  = data.bizObjections;
  }

  async function saveConfig() {
    const config = {
      groqApiKey:       $("groqKey").value.trim(),
      openRouterApiKey: $("openRouterKey").value.trim(),
      bizName:          $("bizName").value.trim(),
      bizProducts:      $("bizProducts").value.trim(),
      bizPriceRange:    $("bizPriceRange").value.trim(),
      bizDelivery:      $("bizDelivery").value.trim(),
      bizReturns:       $("bizReturns").value.trim(),
      bizTone:          $("bizTone").value,
      bizObjections:    $("bizObjections").value.trim()
    };
    await chrome.storage.local.set(config);
    saveStatus.textContent = "✓ Guardado correctamente";
    setTimeout(() => { saveStatus.textContent = ""; }, 2500);
  }

  function getBusinessProfile() {
    return {
      name:         $("bizName").value.trim()       || "Sin nombre",
      products:     $("bizProducts").value.trim()   || "No especificado",
      priceRange:   $("bizPriceRange").value.trim() || "No especificado",
      deliveryTime: $("bizDelivery").value.trim()   || "No especificado",
      returnPolicy: $("bizReturns").value.trim()    || "No especificada",
      tone:         $("bizTone").value              || "profesional y amigable",
      objections:   $("bizObjections").value.trim() || "No especificadas"
    };
  }

  // ============================================================
  // NAVEGACIÓN
  // ============================================================

  function showView(name) {
    viewMain.classList.toggle("active", name === "main");
    viewConfig.classList.toggle("active", name === "config");
    mainFooter.style.display = name === "main" ? "flex" : "none";
  }

  // ============================================================
  // LISTENERS
  // ============================================================

  function setupListeners() {
    configBtn.addEventListener("click", () => showView("config"));
    backBtn.addEventListener("click", () => showView("main"));
    saveBtn.addEventListener("click", saveConfig);
    analyzeBtn.addEventListener("click", () => analyzeConversation());
    closedBtn.addEventListener("click", markSaleClosed);
    copyBtn.addEventListener("click", copySuggestion);
  }

  // ============================================================
  // ANALIZAR
  // ============================================================

  async function analyzeConversation(altTone = null) {
    if (isLoading) return;
    const stored = await chrome.storage.local.get(["groqApiKey", "openRouterApiKey"]);
    if (!stored.groqApiKey && !stored.openRouterApiKey) {
      showError("⚠ Configurá al menos una API key. Tocá ⚙");
      return;
    }

    setLoading(true, altTone ? `Generando variante "${altTone}"...` : "Analizando conversación...");

    try {
      await ensureContentScript();
      const chatData = await getChatFromPage();
      if (!chatData.success) throw new Error(chatData.error);

      currentConversation = chatData.conversation;
      updateChatName(chatData.chatName);

      if (!chatData.messageCount || chatData.messageCount === 0) {
        throw new Error("No hay mensajes en este chat. Abrí una conversación.");
      }

      const patterns = await getPatternsForChat(chatData.chatName);
      const businessProfile = getBusinessProfile();
      if (altTone) businessProfile.tone += ` — específicamente más ${altTone}`;

      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_CHAT",
        data: { conversation: chatData.conversation, businessProfile, previousPatterns: patterns }
      });

      if (!response.success) throw new Error(response.error || "Error desconocido.");

      currentSuggestion = response.data;
      renderResults(response.data);
      saveSuggestionToHistory(chatData.chatName, response.data);

    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // ENSURE CONTENT SCRIPT
  // ============================================================

  async function ensureContentScript() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!tabs[0]) return resolve();
        chrome.tabs.sendMessage(tabs[0].id, { type: "PING" }, async (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            try {
              await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ["src/content/content.js"] });
              await new Promise(r => setTimeout(r, 600));
            } catch (e) { console.warn("Inyección fallida:", e.message); }
          }
          resolve();
        });
      });
    });
  }

  // ============================================================
  // GET CHAT
  // ============================================================

  function getChatFromPage() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { resolve({ success: false, error: "No se encontró la pestaña activa." }); return; }
        chrome.tabs.sendMessage(tabs[0].id, { type: "GET_CHAT" }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: "No se pudo leer WhatsApp Web. Recargá la página (F5) e intentá de nuevo." });
          } else {
            resolve(response || { success: false, error: "Sin respuesta." });
          }
        });
      });
    });
  }

  // ============================================================
  // RENDER — nuevo formato con 3 mensajes + análisis
  // ============================================================

  function renderResults(data) {
    hideAllStates();

    // Termómetro
    const score = data.saleTemperature?.score || 0;
    thermoFill.style.width = `${score}%`;
    thermoCursor.style.left = `${Math.min(score, 97)}%`;
    thermoBadge.textContent = `${data.saleTemperature?.label || "—"} · ${score}%`;
    thermoBadge.className = "thermo-badge";
    if (score < 25) thermoBadge.classList.add("cold");
    else if (score < 55) thermoBadge.classList.add("warm");
    else if (score < 80) thermoBadge.classList.add("hot");
    else thermoBadge.classList.add("fire");
    thermoReason.textContent = data.saleTemperature?.reason || "";
    thermoSection.style.display = "block";

    // Momento
    momentTag.textContent = data.momentLabel || data.momentType || "—";
    momentRow.style.display = "flex";

    // Si tiene múltiples mensajes (nuevo formato)
    if (data.messages && data.messages.length > 0) {
      renderMultipleMessages(data);
    } else {
      // Formato fallback (mensaje único)
      suggText.textContent = data.suggestion?.text || "—";
      tacticValue.textContent = data.suggestion?.tactic || "—";
      goalValue.textContent = data.suggestion?.goal || "—";
      reasoningValue.textContent = data.suggestion?.reasoning || "—";
      suggSection.style.display = "flex";
      renderToneOptions(data.altToneOptions || []);
    }
  }

  function renderMultipleMessages(data) {
    // Limpiar contenido previo de mensajes múltiples
    const existing = document.getElementById("multiMsgSection");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "multiMsgSection";
    container.style.cssText = "display:flex;flex-direction:column;gap:10px;";

    // Resaltar cuál es el recomendado
    const recommended = data.suggestion?.tactic || "";

    data.messages.forEach((msg, idx) => {
      const isMain = msg.palanca === recommended || idx === 0;
      const card = document.createElement("div");
      card.className = "suggestion-section";
      card.style.cssText = `display:flex;${isMain ? "border-color:var(--accent);border-width:1.5px;" : "opacity:0.85;"}`;

      const palancaBadge = isMain
        ? `<span style="font-size:9px;background:var(--accent);color:#0f0f0f;padding:2px 7px;border-radius:10px;font-weight:600;font-family:var(--font-mono);letter-spacing:0.05em;">★ RECOMENDADO</span>`
        : `<span style="font-size:9px;color:var(--text3);font-family:var(--font-mono);">OPCIÓN ${idx+1}</span>`;

      card.innerHTML = `
        <div class="suggestion-header">
          <span class="section-label">${msg.palanca || "MENSAJE " + (idx+1)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            ${palancaBadge}
            <button class="btn-icon copy-msg-btn" data-text="${encodeURIComponent(msg.text || "")}">⎘ Copiar</button>
          </div>
        </div>
        <div class="suggestion-text" style="border-left-color:${isMain ? "var(--accent)" : "var(--border2)"};">${msg.text || "—"}</div>
      `;
      container.appendChild(card);
    });

    // Análisis completo (colapsable)
    if (data.fullAnalysis) {
      const analysisCard = document.createElement("div");
      analysisCard.style.cssText = "background:var(--bg2);border:1px solid var(--border);border-radius:10px;overflow:hidden;";

      const hasContent = data.fullAnalysis.recomendacion || data.fullAnalysis.proximo;
      if (hasContent) {
        analysisCard.innerHTML = `
          <button id="toggleAnalysis" style="width:100%;background:none;border:none;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:var(--text2);font-family:var(--font);font-size:11px;font-weight:500;">
            <span>📌 RECOMENDACIÓN Y PRÓXIMOS PASOS</span>
            <span id="toggleArrow" style="font-size:10px;transition:transform 0.2s;">›</span>
          </button>
          <div id="analysisBody" style="display:none;padding:0 14px 12px;font-size:12px;color:var(--text2);line-height:1.7;white-space:pre-wrap;">${(data.fullAnalysis.recomendacion || "") + (data.fullAnalysis.proximo ? "\n\n⏭️ " + data.fullAnalysis.proximo : "")}</div>
        `;
        container.appendChild(analysisCard);
      }
    }

    // Insertar antes del footer
    viewMain.insertBefore(container, document.getElementById("toneRow"));

    // Event listeners para los botones de copiar
    container.querySelectorAll(".copy-msg-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const text = decodeURIComponent(btn.dataset.text || "");
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "✓ Copiado";
          btn.classList.add("copied");
          showToast("Copiado al portapapeles");
          setTimeout(() => { btn.classList.remove("copied"); btn.textContent = "⎘ Copiar"; }, 2000);
        } catch { showToast("No se pudo copiar"); }
      });
    });

    // Toggle análisis
    const toggleBtn = document.getElementById("toggleAnalysis");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const body = document.getElementById("analysisBody");
        const arrow = document.getElementById("toggleArrow");
        const isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "block";
        arrow.style.transform = isOpen ? "" : "rotate(90deg)";
      });
    }

    // Ocultar la sección de sugerencia única
    suggSection.style.display = "none";
    toneRow.style.display = "none";
  }

  function renderToneOptions(options) {
    toneBtns.innerHTML = "";
    if (!options?.length) { toneRow.style.display = "none"; return; }
    toneRow.style.display = "flex";
    options.forEach(tone => {
      const btn = document.createElement("button");
      btn.className = "tone-btn";
      btn.textContent = tone;
      btn.addEventListener("click", () => { if (isLoading) return; analyzeConversation(tone); });
      toneBtns.appendChild(btn);
    });
  }

  // ============================================================
  // COPIAR PRINCIPAL
  // ============================================================

  async function copySuggestion() {
    const text = currentSuggestion?.suggestion?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add("copied");
      copyBtn.textContent = "✓ Copiado";
      showToast("Copiado al portapapeles");
      setTimeout(() => { copyBtn.classList.remove("copied"); copyBtn.textContent = "⎘ Copiar"; }, 2000);
    } catch { showToast("No se pudo copiar"); }
  }

  // ============================================================
  // VENTA CERRADA
  // ============================================================

  async function markSaleClosed() {
    if (!currentChatName) { showToast("Abrí un chat primero"); return; }
    const history = await getChatHistory(currentChatName);
    const updated = history.map(e => ({ ...e, outcome: "closed" }));
    await saveChatHistory(currentChatName, updated);
    showToast("🎉 ¡Venta cerrada! Guardado para aprender.");
    closedBtn.textContent = "✓ ¡Cerrada!";
    closedBtn.style.color = "var(--accent)";
    closedBtn.style.borderColor = "var(--accent)";
    setTimeout(() => { closedBtn.textContent = "✓ Venta cerrada"; closedBtn.style.color = ""; closedBtn.style.borderColor = ""; }, 3000);
  }

  // ============================================================
  // HISTORIAL
  // ============================================================

  async function saveSuggestionToHistory(chatName, data) {
    const history = await getChatHistory(chatName);
    history.push({
      timestamp: Date.now(),
      tactic: data.suggestion?.tactic || "",
      context: (currentConversation || "").slice(-300),
      momentType: data.momentType || "",
      score: data.saleTemperature?.score || 0,
      outcome: "pending"
    });
    await saveChatHistory(chatName, history.slice(-20));
  }

  async function getPatternsForChat(chatName) {
    const history = await getChatHistory(chatName);
    return history.filter(e => e.outcome !== "pending").slice(-10);
  }

  async function getChatHistory(chatName) {
    const key = `history_${sanitizeKey(chatName)}`;
    const data = await chrome.storage.local.get(key);
    return data[key] || [];
  }

  async function saveChatHistory(chatName, history) {
    const key = `history_${sanitizeKey(chatName)}`;
    await chrome.storage.local.set({ [key]: history });
  }

  function sanitizeKey(str) {
    return str.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 80);
  }

  // ============================================================
  // UI HELPERS
  // ============================================================

  function updateChatName(name) {
    if (!name) return;
    currentChatName = name;
    chatNameEl.textContent = name;
    dotEl.classList.add("active");
  }

  function setLoading(state, text = "Analizando...") {
    isLoading = state;
    analyzeBtn.disabled = state;
    if (state) {
      hideAllStates();
      loadingText.textContent = text;
      loadingState.style.display = "flex";
    } else {
      loadingState.style.display = "none";
    }
  }

  function showError(msg) {
    hideAllStates();
    errorText.textContent = msg;
    errorState.style.display = "block";
  }

  function hideAllStates() {
    emptyState.style.display = "none";
    errorState.style.display = "none";
    loadingState.style.display = "none";
    thermoSection.style.display = "none";
    momentRow.style.display = "none";
    suggSection.style.display = "none";
    toneRow.style.display = "none";
    const existing = document.getElementById("multiMsgSection");
    if (existing) existing.remove();
  }

  function resetResults() {
    hideAllStates();
    emptyState.style.display = "flex";
    currentSuggestion = null;
    currentConversation = "";
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }

  init();
})();
