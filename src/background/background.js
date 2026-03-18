// Sales Copilot — Background Service Worker
// Maneja comunicación entre content script y side panel
// y hace las llamadas a las APIs de IA

// Abrir side panel automáticamente cuando se activa en WhatsApp Web
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes("web.whatsapp.com")) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Configurar side panel para que esté disponible solo en WhatsApp Web
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (tab.url.includes("web.whatsapp.com")) {
      chrome.sidePanel.setOptions({
        tabId,
        path: "src/panel/panel.html",
        enabled: true
      });
    } else {
      chrome.sidePanel.setOptions({
        tabId,
        enabled: false
      });
    }
  }
});

// Router de mensajes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_CHAT") {
    handleAnalysis(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // mantener canal abierto para respuesta async
  }

  if (message.type === "GET_CHAT") {
    // Solicitar al content script el chat activo
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "GET_CHAT" }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true;
  }
});

// ============================================================
// MOTOR DE IA — Grok primero, OpenRouter como fallback
// ============================================================

async function handleAnalysis({ conversation, businessProfile, previousPatterns }) {
  const config = await chrome.storage.local.get(["grokApiKey", "openRouterApiKey"]);

  const prompt = buildPrompt(conversation, businessProfile, previousPatterns);

  // Intentar con Grok primero
  if (config.grokApiKey) {
    try {
      const result = await callGrok(prompt, config.grokApiKey);
      return result;
    } catch (err) {
      console.warn("Grok falló, intentando con OpenRouter...", err.message);
    }
  }

  // Fallback a OpenRouter
  if (config.openRouterApiKey) {
    try {
      const result = await callOpenRouter(prompt, config.openRouterApiKey);
      return result;
    } catch (err) {
      throw new Error("Ambas APIs fallaron: " + err.message);
    }
  }

  throw new Error("No hay APIs configuradas. Por favor configurá tus API keys.");
}

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildPrompt(conversation, businessProfile, previousPatterns) {
  const patternsSection = previousPatterns && previousPatterns.length > 0
    ? `\n\n## PATRONES APRENDIDOS DE ESTE NEGOCIO\nEstas situaciones pasadas te van a ayudar a calibrar mejor la sugerencia:\n${previousPatterns.map((p, i) =>
        `${i + 1}. Situación: "${p.context}" → Táctica usada: "${p.tactic}" → Resultado: ${p.outcome === 'closed' ? '✅ Venta cerrada' : p.outcome === 'improved' ? '📈 Conversación mejoró' : '📉 No mejoró'}`
      ).join('\n')}`
    : '';

  return `Eres un experto en ventas para e-commerce con 15 años de experiencia. Tu trabajo es analizar conversaciones de WhatsApp y dar la MEJOR sugerencia de respuesta para avanzar la venta.

## PERFIL DEL NEGOCIO
Nombre: ${businessProfile.name || 'No especificado'}
Rubro: ${businessProfile.industry || 'E-commerce'}
Productos/Servicios: ${businessProfile.products || 'No especificado'}
Rango de precios: ${businessProfile.priceRange || 'No especificado'}
Tiempo de entrega: ${businessProfile.deliveryTime || 'No especificado'}
Política de devoluciones: ${businessProfile.returnPolicy || 'No especificada'}
Tono de la marca: ${businessProfile.tone || 'Profesional y amigable'}
Objeciones frecuentes y cómo manejarlas:
${businessProfile.objections || 'No especificadas'}${patternsSection}

## CONVERSACIÓN ACTUAL (de más antigua a más reciente)
${conversation}

## TU ANÁLISIS — Respondé ÚNICAMENTE con este JSON válido, sin markdown, sin texto extra:
{
  "saleTemperature": {
    "score": <número del 0 al 100>,
    "label": "<Frío | Tibio | Caliente | Listo para cerrar>",
    "reason": "<razón en 1 oración, máximo 15 palabras>"
  },
  "momentType": "<objecion_precio | objecion_entrega | objecion_confianza | cierre | upsell | cliente_frio | consulta_inicial | otro>",
  "momentLabel": "<etiqueta legible del momento, ej: Objeción de precio>",
  "suggestion": {
    "text": "<el texto exacto listo para copiar y pegar en WhatsApp, natural, sin saludos formales>",
    "tactic": "<nombre de la táctica usada, ej: Anclaje de valor, Urgencia suave, Prueba social>",
    "goal": "<qué se busca lograr con esta respuesta, 1 oración>",
    "reasoning": "<por qué esta es la mejor respuesta en este contexto, 2-3 oraciones>"
  },
  "altToneOptions": ["más empático", "más directo", "con urgencia"]
}`;
}

// ============================================================
// LLAMADA A GROK (xAI)
// ============================================================

async function callGrok(prompt, apiKey) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "grok-beta",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content.trim();
  return parseAIResponse(text, "grok");
}

// ============================================================
// LLAMADA A OPENROUTER (fallback)
// ============================================================

async function callOpenRouter(prompt, apiKey) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/quenomeimportacosas-art/asistentedeventaswhatsapp",
      "X-Title": "Sales Copilot WhatsApp"
    },
    body: JSON.stringify({
      model: "mistralai/mistral-7b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content.trim();
  return parseAIResponse(text, "openrouter");
}

// ============================================================
// PARSER DE RESPUESTA IA
// ============================================================

function parseAIResponse(text, source) {
  try {
    // Limpiar posibles bloques de código markdown
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    parsed._source = source;
    parsed._timestamp = Date.now();
    return parsed;
  } catch (e) {
    throw new Error("La IA devolvió un formato inesperado. Intentá de nuevo.");
  }
}
