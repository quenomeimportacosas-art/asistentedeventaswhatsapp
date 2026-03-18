// Sales Copilot — Background Service Worker

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

async function handleAnalysis({ conversation, businessProfile, previousPatterns }) {
  const config = await chrome.storage.local.get(["groqApiKey", "openRouterApiKey"]);
  const prompt = buildPrompt(conversation, businessProfile, previousPatterns);

  if (config.groqApiKey) {
    try {
      return await callGroq(prompt, config.groqApiKey);
    } catch (err) {
      console.warn("Groq falló, usando OpenRouter...", err.message);
    }
  }

  if (config.openRouterApiKey) {
    try {
      return await callOpenRouter(prompt, config.openRouterApiKey);
    } catch (err) {
      throw new Error("Ambas APIs fallaron: " + err.message);
    }
  }

  throw new Error("No hay APIs configuradas. Tocá ⚙ para configurar tus API keys.");
}

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
Respondé ÚNICAMENTE con este JSON válido. Sin markdown, sin texto antes o después, solo el JSON:
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
    throw new Error(`Groq error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return parseAIResponse(data.choices[0].message.content.trim(), "groq");
}

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
    throw new Error(`OpenRouter error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return parseAIResponse(data.choices[0].message.content.trim(), "openrouter");
}

function parseAIResponse(text, source) {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    parsed._source = source;
    parsed._timestamp = Date.now();
    return parsed;
  } catch (e) {
    throw new Error("La IA devolvió formato inesperado. Intentá de nuevo.");
  }
}
