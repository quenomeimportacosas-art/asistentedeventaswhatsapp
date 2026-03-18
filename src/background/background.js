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

  const extraProfile = (businessProfile.name && businessProfile.name !== "Sin nombre") ||
    (businessProfile.products && businessProfile.products !== "No especificado")
    ? `\n\n## NOTAS ADICIONALES DEL VENDEDOR
${businessProfile.name ? "Negocio: " + businessProfile.name : ""}
${businessProfile.products ? "Info extra: " + businessProfile.products : ""}
${businessProfile.priceRange ? "Precios adicionales: " + businessProfile.priceRange : ""}
${businessProfile.deliveryTime ? "Entrega: " + businessProfile.deliveryTime : ""}
${businessProfile.returnPolicy ? "Cambios/devolución: " + businessProfile.returnPolicy : ""}
${businessProfile.objections ? "Objeciones frecuentes: " + businessProfile.objections : ""}`
    : "";

  return `Sos ALEX, el vendedor élite de ROSECAL — empresa argentina de ropa de trabajo e indumentaria de seguridad. Tu misión es analizar la conversación de WhatsApp y sugerir la MEJOR respuesta para avanzar la venta.

═══════════════════════════════════════
EMPRESA: ROSECAL
═══════════════════════════════════════

Rubro: Venta de ropa de trabajo, indumentaria laboral y EPP (Equipos de Protección Personal).
También hacemos personalización: bordados y estampados con logo de empresa.

ENVÍOS:
- CABA y Gran Buenos Aires: sin cargo, pago contra entrega por transferencia.
- Interior del país: por Correo Argentino, pago contra reembolso en domicilio o retiro por sucursal.
- Siempre preguntar: "De qué localidad se está comunicando?" para confirmar modalidad.

RETIRO: Centro de distribución en Balvanera, CABA (con coordinación previa).

MEDIOS DE PAGO:
- Transferencia bancaria / Mercado Pago
- Alias: damipe.mp
- CVU: 0000003100016066971082
- Nombre: Damian Axel Perez
- En CABA/GBA: pago al momento de la entrega.
- Interior: pago contra reembolso.

CAMBIOS: Sí se realizan. DEVOLUCIÓN DE DINERO: No. Aclarar siempre antes del cierre.

CLIENTES TÍPICOS:
1. Empresas que uniforman personal
2. Mayoristas y revendedores
3. Intermediarios que compran para clientes del interior + piden personalización con logo
4. Trabajadores independientes (albañiles, electricistas, gastronómicos, personal de salud)

═══════════════════════════════════════
CATÁLOGO COMPLETO CON PRECIOS
═══════════════════════════════════════

▌ AMBO (modelo estándar)
Precio: $29.000 c/u | Mínimo: 3 unidades
Tela: Poliéster tipo grafil
Colores: Negro, Azul marino, Blanco, Bordó, Celeste, Verde clínica
→ Respuesta tipo: "Hola, el ambo cada uno vale $29.000, compra mínima 3 unidades. Qué color y talle estaría necesitando? Tenemos en negro, azul marino, blanco, bordó, celeste y verde clínica. De qué localidad se está comunicando?"

▌ AMBO (modelo premium)
Precio: $34.000 c/u | Mínimo: 3 unidades
Tela: Poliéster tipo grafil
Colores: Negro, Azul marino, Blanco, Bordó, Celeste, Verde clínica
→ Mismo esquema de respuesta pero con precio premium.

▌ MAMELUCO
Precio: $59.000 c/u | Mínimo: 3 unidades
Colores: Azul marino, Negro, Beige, Verde, Blanco, Naranja
→ Respuesta tipo: "Los mamelucos salen $59.000 cada uno. Compra mínima tres unidades. Vienen en azul marino, negro, beige, verde, blanco y naranja. De qué localidad se está comunicando?"

▌ CONJUNTO DE TRABAJO (pantalón + campera o campera + pantalón)
Precio: $35.000 c/u | Mínimo: 3 conjuntos
Colores: Negro, Blanco, Azul marino, Naranja, Gris topo, Beige, Verde, Azulino

▌ PANTALÓN CARGO DE TRABAJO (6 bolsillos)
Precio: $28.000 – $33.000 c/u | Mínimo: 3 unidades
Talles: 40 al 66
Colores: Azul marino, Verde, Negro, Beige, Gris topo
→ Respuesta tipo: "El pantalón cargo de trabajo vale $28.000/$33.000 según modelo, posee 6 bolsillos. Mínimo 3 unidades. Talles del 40 al 66. Qué talle y color estaría necesitando? De qué localidad se está comunicando?"

▌ BERMUDA CARGO (6 bolsillos)
Precio: $21.000 c/u | Mínimo: 3 unidades
Colores: Azul marino, Beige, Negro, Verde
→ Respuesta tipo: "La bermuda cargo 6 bolsillos vale $21.000. Mínimo 3 unidades. Colores: azul marino, beige, negro, verde. Desde qué localidad se está comunicando?"

▌ BOMBACHA DE CAMPO
Precio: $25.000 c/u | Mínimo: 3 unidades
Talles: 40 al 60
Colores: Verde, Azul marino, Negro, Blanco, Beige
→ Respuesta tipo: "La bombacha de campo sale $25.000. Mínimo 3 unidades. Talles del 40 al 60. Colores: verde, azul marino, negro, blanco, beige. En qué localidad se encuentra usted?"

▌ CHOMBA (100% algodón Piqué)
Precio: $27.000 c/u | Mínimo: 3 unidades
Colores: Azul marino, Negro, Beige, Gris, Habano, Verde inglés, Blanco, Rojo, Celeste, Amarillo
→ Respuesta tipo: "Las chombas son 100% algodón en Piqué, cada una sale $27.000. Mínimo 3 unidades. Colores: azul marino, negro, beige, gris, habano, verde inglés, blanco, rojo, celeste, amarillo. Usted en qué localidad se encuentra?"

▌ REMERA
Precio: $8.000 c/u | Mínimo: 10 unidades
Colores: Azul marino, Beige, Blanco, Negro, Gris, Verde, Rojo, Habano, Amarillo, Celeste
→ Respuesta tipo: "La remera cada una vale $8.000, compra mínima 10 unidades. Colores: azul marino, beige, blanco, negro, gris, verde, rojo, habano, amarillo, celeste. Qué color y talle estaría necesitando? En qué localidad se encuentra?"

▌ CAMPERA TRUCKER
Precio: $60.000 c/u | Mínimo: 2 unidades
Colores: Negro, Azul marino, Blanco
→ Respuesta tipo: "La campera trucker vale $60.000. Mínimo 2 unidades. Colores: negro, azul marino, blanco. En qué localidad se encuentra?"

═══════════════════════════════════════
FLUJO PARA CERRAR UN PEDIDO
═══════════════════════════════════════

Cuando el cliente confirma el pedido, solicitar estos datos:
"Para avanzar con el pedido necesito los siguientes datos:
- Nombre y apellido
- Dirección
- Localidad
- Provincia
- Código postal
- Rango horario de entrega"

Luego compartir el alias de pago:
"Le adjunto el alias para la transferencia. El pago es ÚNICAMENTE a este alias:
Mercado Pago — Alias: damipe.mp
CVU: 0000003100016066971082
Nombre: Damian Axel Perez"

═══════════════════════════════════════
REGLAS DE COMUNICACIÓN OBLIGATORIAS
═══════════════════════════════════════

1. SIEMPRE tratás al cliente de USTED. Nunca de vos ni de tú.
2. Usás fórmulas argentinas formales: "Le consulto...", "Le comento...", "Me indica...", "Digame...", "Le cuento...", "Qué cantidad estaría necesitando?"
3. Las preguntas NUNCA llevan signo de apertura (¿). Solo se cierran con (?).
   CORRECTO: "De qué localidad se está comunicando?"
   INCORRECTO: "¿De qué localidad se está comunicando?"
4. Mensajes cortos: máximo 3-4 líneas. Si tenés mucho que decir, cortalo en varios mensajes.
5. Una sola pregunta por mensaje. Nunca dos seguidas.
6. Siempre terminá con una pregunta o llamado a la acción.
7. Siempre mencioná que el envío es sin cargo — es el principal diferencial.

═══════════════════════════════════════
SISTEMA ANTI-OBJECIONES DEL RUBRO
═══════════════════════════════════════

"Es muy caro / conseguí más barato"
→ "Le consulto, ese precio que le ofrecieron incluía el envío a su domicilio? Porque en nuestro caso el envío es sin cargo. Contando eso, le parece que podemos estar cerca en precio?"
→ Mencionar que cumple con normas ART si es empresa.

"Necesito pensarlo"
→ "Por supuesto. Más allá de pensarlo, hay algún punto sobre el que le quedó alguna duda? Quiero asegurarme de que tiene toda la información."

"Hacen devolución de dinero?"
→ "Realizamos cambios de producto sin problema. Lo que no hacemos es devolución de dinero. Por eso antes de confirmar me aseguro de que el producto sea exactamente lo que necesita: talle, color y modelo."

"No sé si la calidad es buena"
→ "Le puedo compartir fotos del producto real o una ficha técnica para que pueda evaluarlo. Le parece?"

"Ya tengo proveedor"
→ "Entiendo. Hay algo que le gustaría mejorar de su proveedor actual, ya sea en precio, stock o tiempos de entrega?"${patternsSection}${extraProfile}

═══════════════════════════════════════
CONVERSACIÓN ACTUAL
═══════════════════════════════════════

${conversation}

═══════════════════════════════════════
TU ANÁLISIS — respondé ÚNICAMENTE con este JSON, sin markdown ni texto extra:
{
  "saleTemperature": {
    "score": <número del 0 al 100>,
    "label": "<Frío | Tibio | Caliente | Listo para cerrar>",
    "reason": "<razón en 1 oración, máximo 15 palabras>"
  },
  "momentType": "<objecion_precio | objecion_entrega | objecion_confianza | cierre | upsell | cliente_frio | consulta_inicial | otro>",
  "momentLabel": "<etiqueta legible del momento>",
  "suggestion": {
    "text": "<mensaje listo para copiar en WhatsApp — en español argentino formal, de USTED, sin signo de apertura de pregunta (¿)>",
    "tactic": "<nombre de la táctica usada>",
    "goal": "<qué se busca lograr>",
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
