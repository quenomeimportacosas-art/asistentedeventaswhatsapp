// Sales Copilot — Panel JS
// Maneja toda la lógica del side panel

(function () {
  "use strict";

  // ============================================================
  // REFERENCIAS DOM
  // ============================================================
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

  // Estado de la app
  let currentChatName = "";
  let currentSuggestion = null;
  let currentConversation = "";
  let isLoading = false;

  // ============================================================
  // INICIALIZACIÓN
  // ============================================================

  async function init() {
    loadConfig();
    setupListeners();
    // Escuchar cambios de chat desde el content script
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "CHAT_CHANGED") {
        updateChatName(msg.chatName);
        resetResults();
      }
    });
  }

  // ============================================================
  // CONFIG
  // ============================================================

  async function loadConfig() {
    const data = await chrome.storage.local.get([
      "grokApiKey", "openRouterApiKey",
      "bizName", "bizProducts", "bizPriceRange",
      "bizDelivery", "bizReturns", "bizTone", "bizObjections"
    ]);

    if (data.grokApiKey)      $("grokKey").value       = data.grokApiKey;
    if (data.openRouterApiKey) $("openRouterKey").value = data.openRouterApiKey;
    if (data.bizName)         $("bizName").value        = data.bizName;
    if (data.bizProducts)     $("bizProducts").value    = data.bizProducts;
    if (data.bizPriceRange)   $("bizPriceRange").value  = data.bizPriceRange;
    if (data.bizDelivery)     $("bizDelivery").value    = data.bizDelivery;
    if (data.bizReturns)      $("bizReturns").value     = data.bizReturns;
    if (data.bizTone)         $("bizTone").value        = data.bizTone;
    if (data.bizObjections)   $("bizObjections").value  = data.bizObjections;
  }

  async function saveConfig() {
    const config = {
      grokApiKey:       $("grokKey").value.trim(),
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
  // NAVEGACIÓN DE VISTAS
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
    analyzeBtn.addEventListener("click", analyzeConversation);
    closedBtn.addEventListener("click", markSaleClosed);
    copyBtn.addEventListener("click", copySuggestion);
  }

  // ============================================================
  // ANALIZAR CONVERSACIÓN
  // ============================================================

  async function analyzeConversation(altTone = null) {
    if (isLoading) return;

    // Verificar que hay API key configurada
    const stored = await chrome.storage.local.get(["grokApiKey", "openRouterApiKey"]);
    if (!stored.grokApiKey && !stored.openRouterApiKey) {
      showError("⚠ Necesitás configurar al menos una API key. Tocá ⚙ para configurar.");
      return;
    }

    setLoading(true, altTone ? `Generando variante "${altTone}"...` : "Analizando conversación...");

    try {
      // 1. Obtener chat del content script
      const chatData = await getChatFromPage();
      if (!chatData.success) {
        throw new Error(chatData.error || "No se pudo leer el chat. ¿Tenés WhatsApp Web abierto con un chat activo?");
      }

      currentConversation = chatData.conversation;
      updateChatName(chatData.chatName);

      if (!currentConversation || chatData.messageCount === 0) {
        throw new Error("No se encontraron mensajes en este chat. Abrí una conversación primero.");
      }

      // 2. Obtener patrones aprendidos para este chat
      const patterns = await getPatternsForChat(chatData.chatName);

      // 3. Construir prompt (con tono alternativo si aplica)
      const businessProfile = getBusinessProfile();
      if (altTone) {
        businessProfile.tone = `${businessProfile.tone} — esta vez específicamente más ${altTone}`;
      }

      // 4. Enviar al background para llamar a la IA
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_CHAT",
        data: {
          conversation: currentConversation,
          businessProfile,
          previousPatterns: patterns
        }
      });

      if (!response.success) {
        throw new Error(response.error || "Error desconocido al llamar a la IA.");
      }

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
  // OBTENER CHAT DEL CONTENT SCRIPT
  // ============================================================

  function getChatFromPage() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          resolve({ success: false, error: "No se encontró la pestaña activa." });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { type: "GET_CHAT" }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: "El content script no respondió. Recargá WhatsApp Web."
            });
          } else {
            resolve(response || { success: false, error: "Sin respuesta del content script." });
          }
        });
      });
    });
  }

  // ============================================================
  // RENDERIZAR RESULTADOS
  // ============================================================

  function renderResults(data) {
    hideAllStates();

    // Termómetro
    const score = data.saleTemperature?.score || 0;
    const label = data.saleTemperature?.label || "—";
    const reason = data.saleTemperature?.reason || "";

    thermoFill.style.width = `${score}%`;
    thermoCursor.style.left = `${score}%`;
    thermoBadge.textContent = `${label} · ${score}%`;

    // Clase de color del badge
    thermoBadge.className = "thermo-badge";
    if (score < 25) thermoBadge.classList.add("cold");
    else if (score < 55) thermoBadge.classList.add("warm");
    else if (score < 80) thermoBadge.classList.add("hot");
    else thermoBadge.classList.add("fire");

    thermoReason.textContent = reason;
    thermoSection.style.display = "block";

    // Momento
    momentTag.textContent = data.momentLabel || data.momentType || "—";
    momentRow.style.display = "flex";

    // Sugerencia
    suggText.textContent = data.suggestion?.text || "—";
    tacticValue.textContent = data.suggestion?.tactic || "—";
    goalValue.textContent = data.suggestion?.goal || "—";
    reasoningValue.textContent = data.suggestion?.reasoning || "—";
    suggSection.style.display = "flex";

    // Variantes de tono
    renderToneOptions(data.altToneOptions || []);
  }

  function renderToneOptions(options) {
    toneBtns.innerHTML = "";
    if (!options || options.length === 0) {
      toneRow.style.display = "none";
      return;
    }
    toneRow.style.display = "flex";
    options.forEach(tone => {
      const btn = document.createElement("button");
      btn.className = "tone-btn";
      btn.textContent = tone;
      btn.addEventListener("click", () => {
        if (isLoading) return;
        btn.classList.add("loading");
        analyzeConversation(tone).finally(() => btn.classList.remove("loading"));
      });
      toneBtns.appendChild(btn);
    });
  }

  // ============================================================
  // COPIAR SUGERENCIA
  // ============================================================

  async function copySuggestion() {
    if (!currentSuggestion?.suggestion?.text) return;
    try {
      await navigator.clipboard.writeText(currentSuggestion.suggestion.text);
      copyBtn.classList.add("copied");
      copyBtn.textContent = "✓ Copiado";
      showToast("Copiado al portapapeles");
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.textContent = "⎘ Copiar";
      }, 2000);
    } catch {
      showToast("No se pudo copiar");
    }
  }

  // ============================================================
  // MARCAR VENTA CERRADA
  // ============================================================

  async function markSaleClosed() {
    if (!currentChatName) {
      showToast("Abrí un chat primero");
      return;
    }

    const history = await getChatHistory(currentChatName);
    const updated = history.map(entry => ({
      ...entry,
      outcome: "closed"
    }));

    await saveChatHistory(currentChatName, updated);
    showToast("🎉 ¡Venta cerrada! Guardado para aprender.");

    closedBtn.textContent = "✓ ¡Cerrada!";
    closedBtn.style.color = "var(--accent)";
    closedBtn.style.borderColor = "var(--accent)";
    setTimeout(() => {
      closedBtn.textContent = "✓ Venta cerrada";
      closedBtn.style.color = "";
      closedBtn.style.borderColor = "";
    }, 3000);
  }

  // ============================================================
  // HISTORIAL Y PATRONES (loop de aprendizaje)
  // ============================================================

  async function saveSuggestionToHistory(chatName, data) {
    const history = await getChatHistory(chatName);
    history.push({
      timestamp: Date.now(),
      tactic: data.suggestion?.tactic || "",
      context: (currentConversation || "").slice(-300),
      momentType: data.momentType || "",
      score: data.saleTemperature?.score || 0,
      outcome: "pending" // se actualiza cuando cierra la venta o en la próxima análisis
    });
    // Guardar máximo 20 entradas por chat
    const trimmed = history.slice(-20);
    await saveChatHistory(chatName, trimmed);
  }

  async function getPatternsForChat(chatName) {
    const history = await getChatHistory(chatName);
    // Solo devolver los que tienen outcome definido (no pending)
    return history
      .filter(e => e.outcome !== "pending")
      .slice(-10); // últimos 10 patrones
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
    emptyState.style.display = "none";
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

  // ============================================================
  // ARRANCAR
  // ============================================================
  init();

})();
