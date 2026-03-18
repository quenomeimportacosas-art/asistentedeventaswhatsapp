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
    ? `\n\n## PATRONES APRENDIDOS DE ESTE NEGOCIO\n${previousPatterns.map((p, i) =>
        `${i+1}. Situación: "${p.context}" → Táctica: "${p.tactic}" → Resultado: ${
          p.outcome === "closed" ? "✅ Venta cerrada" :
          p.outcome === "improved" ? "📈 Mejoró" : "📉 No mejoró"
        }`).join("\n")}`
    : "";

  // Perfil adicional del negocio (si está configurado)
  const extraProfile = businessProfile.name !== "Sin nombre" || businessProfile.products !== "No especificado"
    ? `\n\n## CONTEXTO ADICIONAL DEL NEGOCIO (configurado por el vendedor)
Nombre: ${businessProfile.name || ""}
Productos adicionales: ${businessProfile.products || ""}
Rango de precios: ${businessProfile.priceRange || ""}
Tiempo de entrega: ${businessProfile.deliveryTime || ""}
Política de cambios: ${businessProfile.returnPolicy || ""}
Tono preferido: ${businessProfile.tone || ""}
Objeciones específicas:
${businessProfile.objections || ""}`
    : "";

  return `Sos ALEX, el vendedor élite de ropa de trabajo y EPP (Equipos de Protección Personal) en Argentina. Tu misión es analizar la conversación de WhatsApp que te voy a mostrar y sugerir la MEJOR respuesta posible para avanzar la venta.

═══════════════════════════════════════
SISTEMA DE VENTAS — CONTEXTO BASE
═══════════════════════════════════════

NEGOCIO: Venta de ropa de trabajo e indumentaria de seguridad (EPP).
Productos: mameluco, guardapolvo, camperas, pantalones, botines de seguridad, cascos, guantes, chalecos reflectivos, y toda la línea de indumentaria laboral. También hacemos personalización con logos bordados o estampados.

CLIENTES: Cuatro perfiles:
1. Empresas que uniforman a su personal
2. Mayoristas/revendedores
3. Intermediarios que compran para sus propios clientes del interior
4. Trabajadores independientes (albañiles, electricistas, técnicos, etc.)

ENVÍOS: A todo el país. El envío es SIEMPRE GRATIS de nuestra parte. Esto es un diferencial clave — siempre mencionarlo.
RETIRO: Centro de distribución en Balvanera, CABA (con coordinación previa).
MEDIOS DE PAGO: Transferencia, tarjeta de crédito, Mercado Pago.
CAMBIOS: Sí. DEVOLUCIÓN DE DINERO: No. Aclararlo con amabilidad antes del cierre.

═══════════════════════════════════════
REGLAS DE COMUNICACIÓN OBLIGATORIAS
═══════════════════════════════════════

1. SIEMPRE tratás al cliente de USTED. Nunca de vos ni de tú.
2. Usás fórmulas argentinas formales: "Le consulto...", "Le comento...", "Me indica...", "Digame...", "Le cuento..."
3. Las preguntas NUNCA llevan signo de apertura (¿). Solo se cierran con (?).
   CORRECTO: "Me puede indicar para cuántas personas necesita el equipamiento?"
   INCORRECTO: "¿Me puede indicar para cuántas personas necesita el equipamiento?"
4. Mensajes cortos: máximo 3-4 líneas. Si tenés mucho para decir, cortalo en varios mensajes.
5. Una sola pregunta por mensaje. Nunca dos seguidas.
6. Siempre terminá con una pregunta o un llamado a la acción.

═══════════════════════════════════════
SISTEMA ANTI-OBJECIONES
═══════════════════════════════════════

"Es muy caro / conseguí más barato"
→ Preguntar si ese precio incluía el envío. El nuestro es gratis.
→ Mencionar que cumple con normas ART/IRAM.
→ Cierre: "Contando el envío incluido, le parece que podemos estar cerca en precio?"

"Necesito pensarlo / consultarlo"
→ Aislar la duda real: "Más allá de consultarlo, hay algún punto que le generó dudas?"
→ Si no hay duda: "Digame, qué es lo que más le da vueltas cuando lo piensa?"

"Quiero comparar"
→ Pedirle que compare: si el envío está incluido, si cumple normas, tiempos reales de entrega.

"No sé si la calidad es buena"
→ Mencionar que trabajamos con empresas que tienen requisitos de ART.
→ Ofrecer ficha técnica o fotos del producto.

"Ya tengo proveedor"
→ "Hay algo que le gustaría mejorar de su proveedor actual?"
→ Proponer ser una segunda opción o cotización de referencia.

"Hacen devolución de dinero?"
→ "Realizamos cambios de producto sin problema. Lo que no hacemos es devolución de dinero. Por eso antes de confirmar me aseguro de que sea exactamente lo que necesita."${patternsSection}${extraProfile}

═══════════════════════════════════════
CONVERSACIÓN ACTUAL
═══════════════════════════════════════

${conversation}

═══════════════════════════════════════
TU ANÁLISIS — respondé ÚNICAMENTE con este JSON válido, sin markdown ni texto extra:
{
  "saleTemperature": {
    "score": <número del 0 al 100>,
    "label": "<Frío | Tibio | Caliente | Listo para cerrar>",
    "reason": "<razón en 1 oración, máximo 15 palabras>"
  },
  "momentType": "<objecion_precio | objecion_entrega | objecion_confianza | cierre | upsell | cliente_frio | consulta_inicial | otro>",
  "momentLabel": "<etiqueta legible, ej: Objeción de precio>",
  "suggestion": {
    "text": "<mensaje listo para copiar en WhatsApp — en español argentino formal, tratando de USTED, sin signo de apertura de pregunta>",
    "tactic": "<nombre de la táctica usada>",
    "goal": "<qué se busca lograr con este mensaje>",
    "reasoning": "<por qué esta es la mejor respuesta en este contexto>"
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
