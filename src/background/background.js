// Sales Copilot — Background Service Worker
// Modelos actualizados al 18/03/2026

chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes("web.whatsapp.com")) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (tab.url.includes("web.whatsapp.com")) {
      chrome.sidePanel.setOptions({ tabId, path: "src/panel/panel.html", enabled: true });
    } else {
      chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_CHAT") {
    handleAnalysis(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "GET_CHAT") {
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
// CADENA DE MODELOS — ordenados por calidad/disponibilidad
// Groq (gratis, rapidísimo) → OpenRouter (fallback gratuito)
// ============================================================

const GROQ_MODELS = [
  "llama-3.3-70b-versatile",   // Principal — reemplaza al deprecated llama3-70b-8192
  "llama-3.1-8b-instant",      // Backup Groq — más liviano pero muy rápido
];

const OPENROUTER_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "google/gemma-3-27b-it:free",
];

async function handleAnalysis({ conversation, businessProfile, previousPatterns }) {
  const config = await chrome.storage.local.get(["groqApiKey", "openRouterApiKey"]);
  const prompt = buildPrompt(conversation, businessProfile, previousPatterns);
  const errors = [];

  // 1. Intentar con todos los modelos de Groq
  if (config.groqApiKey) {
    for (const model of GROQ_MODELS) {
      try {
        console.log(`[Sales Copilot] Groq → ${model}`);
        return await callGroq(prompt, config.groqApiKey, model);
      } catch (err) {
        console.warn(`[Sales Copilot] Groq/${model} falló:`, err.message);
        errors.push(`Groq/${model}: ${err.message.slice(0, 80)}`);
        // Si es rate limit (429), seguir intentando con el siguiente
        // Si es error de auth (401), no tiene sentido seguir con Groq
        if (err.message.includes("401") || err.message.includes("Invalid API Key")) break;
      }
    }
  }

  // 2. Intentar con todos los modelos de OpenRouter
  if (config.openRouterApiKey) {
    for (const model of OPENROUTER_MODELS) {
      try {
        console.log(`[Sales Copilot] OpenRouter → ${model}`);
        return await callOpenRouter(prompt, config.openRouterApiKey, model);
      } catch (err) {
        console.warn(`[Sales Copilot] OpenRouter/${model} falló:`, err.message);
        errors.push(`OpenRouter/${model}: ${err.message.slice(0, 80)}`);
        if (err.message.includes("401") || err.message.includes("Invalid API Key")) break;
      }
    }
  }

  if (!config.groqApiKey && !config.openRouterApiKey) {
    throw new Error("No hay APIs configuradas. Tocá ⚙ para agregar tus API keys.");
  }

  throw new Error("Todos los modelos están temporalmente ocupados. Esperá unos segundos e intentá de nuevo.");
}

// ============================================================
// PROMPT
// ============================================================

function buildPrompt(conversation, businessProfile, previousPatterns) {
  const patternsSection = previousPatterns && previousPatterns.length > 0
    ? `\n\n## PATRONES APRENDIDOS\n${previousPatterns.map((p, i) =>
        `${i+1}. Situación: "${p.context}" → Táctica: "${p.tactic}" → Resultado: ${
          p.outcome === 'closed' ? '✅ Venta cerrada' :
          p.outcome === 'improved' ? '📈 Mejoró' : '📉 No mejoró'
        }`).join('\n')}`
    : '';

  return `Eres un experto en ventas para e-commerce con 15 años de experiencia. Analizá esta conversación de WhatsApp y dá la MEJOR sugerencia de respuesta para avanzar la venta.

## PERFIL DEL NEGOCIO
Nombre: ${businessProfile.name || 'No especificado'}
Productos/Servicios: ${businessProfile.products || 'No especificado'}
Rango de precios: ${businessProfile.priceRange || 'No especificado'}
Tiempo de entrega: ${businessProfile.deliveryTime || 'No especificado'}
Política de devoluciones: ${businessProfile.returnPolicy || 'No especificada'}
Tono de la marca: ${businessProfile.tone || 'Profesional y amigable'}
Objeciones frecuentes:
${businessProfile.objections || 'No especificadas'}${patternsSection}

## CONVERSACIÓN ACTUAL
${conversation}

## INSTRUCCIÓN CRÍTICA
Respondé ÚNICAMENTE con JSON válido. Sin markdown, sin texto antes o después:
{
  "saleTemperature": {
    "score": <número del 0 al 100>,
    "label": "<Frío | Tibio | Caliente | Listo para cerrar>",
    "reason": "<razón en 1 oración, máximo 15 palabras>"
  },
  "momentType": "<objecion_precio | objecion_entrega | objecion_confianza | cierre | upsell | cliente_frio | consulta_inicial | otro>",
  "momentLabel": "<etiqueta legible, ej: Objeción de precio>",
  "suggestion": {
    "text": "<texto listo para copiar en WhatsApp, natural, sin saludos formales>",
    "tactic": "<nombre de la táctica, ej: Anclaje de valor>",
    "goal": "<qué se busca lograr, 1 oración>",
    "reasoning": "<por qué esta respuesta es la mejor, 2-3 oraciones>"
  },
  "altToneOptions": ["más empático", "más directo", "con urgencia"]
}`;
}

// ============================================================
// GROQ — api.groq.com (gratis, ultra rápido)
// ============================================================

async function callGroq(prompt, apiKey, model) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HTTP ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return parseAIResponse(data.choices[0].message.content.trim(), `groq/${model}`);
}

// ============================================================
// OPENROUTER — fallback gratuito
// ============================================================

async function callOpenRouter(prompt, apiKey, model) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/quenomeimportacosas-art/asistentedeventaswhatsapp",
      "X-Title": "Sales Copilot WhatsApp"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HTTP ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  if (!data.choices?.[0]?.message?.content) {
    throw new Error("Respuesta vacía del modelo");
  }
  return parseAIResponse(data.choices[0].message.content.trim(), `openrouter/${model}`);
}

// ============================================================
// PARSER — robusto contra markdown y texto extra
// ============================================================

function parseAIResponse(text, source) {
  try {
    let clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) clean = jsonMatch[0];
    const parsed = JSON.parse(clean);
    parsed._source = source;
    parsed._timestamp = Date.now();
    return parsed;
  } catch (e) {
    throw new Error(`Formato inesperado de ${source}. Intentá de nuevo.`);
  }
}
