// Sales Copilot — Background Service Worker
// Groq (principal) → OpenRouter Llama 4 Maverick (fallback 1) → OpenRouter Mistral Small (fallback 2)

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
// MOTOR IA — Groq → OpenRouter (múltiples modelos gratuitos)
// ============================================================

async function handleAnalysis({ conversation, businessProfile, previousPatterns }) {
  const config = await chrome.storage.local.get(["groqApiKey", "openRouterApiKey"]);
  const prompt = buildPrompt(conversation, businessProfile, previousPatterns);
  const errors = [];

  // 1. Intentar con Groq (llama3-70b-8192 — rápido y gratis)
  if (config.groqApiKey) {
    try {
      console.log("[Sales Copilot] Intentando con Groq llama3-70b...");
      return await callGroq(prompt, config.groqApiKey);
    } catch (err) {
      console.warn("[Sales Copilot] Groq falló:", err.message);
      errors.push(`Groq: ${err.message}`);
    }
  }

  // 2. Fallback: OpenRouter — Llama 4 Maverick (gratis, muy bueno)
  if (config.openRouterApiKey) {
    try {
      console.log("[Sales Copilot] Intentando con OpenRouter llama-4-maverick...");
      return await callOpenRouter(prompt, config.openRouterApiKey, "meta-llama/llama-4-maverick:free");
    } catch (err) {
      console.warn("[Sales Copilot] llama-4-maverick falló:", err.message);
      errors.push(`Llama-4-Maverick: ${err.message}`);
    }

    // 3. Fallback 2: Llama 3.3 70B (también gratis y muy capaz)
    try {
      console.log("[Sales Copilot] Intentando con OpenRouter llama-3.3-70b...");
      return await callOpenRouter(prompt, config.openRouterApiKey, "meta-llama/llama-3.3-70b-instruct:free");
    } catch (err) {
      console.warn("[Sales Copilot] llama-3.3-70b falló:", err.message);
      errors.push(`Llama-3.3-70B: ${err.message}`);
    }

    // 4. Fallback 3: Mistral Small 3.1 (gratis, liviano)
    try {
      console.log("[Sales Copilot] Intentando con OpenRouter mistral-small-3.1...");
      return await callOpenRouter(prompt, config.openRouterApiKey, "mistralai/mistral-small-3.1-24b-instruct:free");
    } catch (err) {
      console.warn("[Sales Copilot] mistral-small falló:", err.message);
      errors.push(`Mistral-Small: ${err.message}`);
    }
  }

  if (!config.groqApiKey && !config.openRouterApiKey) {
    throw new Error("No hay APIs configuradas. Tocá ⚙ para configurar tus API keys.");
  }

  throw new Error(`Todos los modelos fallaron. Intentá de nuevo en unos segundos.\n${errors.join('\n')}`);
}

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildPrompt(conversation, businessProfile, previousPatterns) {
  const patternsSection = previousPatterns && previousPatterns.length > 0
    ? `\n\n## PATRONES APRENDIDOS DE ESTE NEGOCIO\n${previousPatterns.map((p, i) =>
        `${i + 1}. Situación: "${p.context}" → Táctica: "${p.tactic}" → Resultado: ${p.outcome === 'closed' ? '✅ Venta cerrada' : p.outcome === 'improved' ? '📈 Mejoró' : '📉 No mejoró'}`
      ).join('\n')}`
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
// GROQ (groq.com — Llama 3 70B, gratis y ultra rápido)
// ============================================================

async function callGroq(prompt, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama3-70b-8192",
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
  return parseAIResponse(data.choices[0].message.content.trim(), "groq/llama3-70b");
}

// ============================================================
// OPENROUTER (fallback — múltiples modelos gratuitos)
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
// PARSER
// ============================================================

function parseAIResponse(text, source) {
  try {
    // Limpiar markdown si el modelo lo ignoró
    let clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Extraer JSON si hay texto antes/después
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
