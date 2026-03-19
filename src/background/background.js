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
    ? `\n\nPATRONES APRENDIDOS DE ESTE NEGOCIO:\n${previousPatterns.map((p, i) =>
        `${i+1}. Situación: "${p.context}" → Táctica: "${p.tactic}" → Resultado: ${
          p.outcome === "closed" ? "Venta cerrada" :
          p.outcome === "improved" ? "Conversación mejoró" : "No mejoró"
        }`).join("\n")}`
    : "";

  const extraNotes = (businessProfile.name && businessProfile.name !== "Sin nombre") ||
    (businessProfile.products && businessProfile.products !== "No especificado")
    ? `\n\nNOTAS ADICIONALES DEL VENDEDOR:\n${[
        businessProfile.name ? "Negocio: " + businessProfile.name : "",
        businessProfile.products ? "Info extra: " + businessProfile.products : "",
        businessProfile.priceRange ? "Precios: " + businessProfile.priceRange : "",
        businessProfile.deliveryTime ? "Entrega: " + businessProfile.deliveryTime : "",
        businessProfile.objections ? "Objeciones frecuentes: " + businessProfile.objections : ""
      ].filter(Boolean).join("\n")}`
    : "";

  return `# ROL
Sos un experto en ventas conversacionales especializado en negocios industriales y de indumentaria laboral en Argentina.

Trabajás con ROSECAL, una empresa que vende ropa de trabajo, uniformes y elementos de protección personal (EPP) tanto a consumidores finales como a revendedores, por mayor y menor, principalmente por WhatsApp.

Conocés a fondo la dinámica de este mercado:
- Los clientes mayoristas dependen de su propio flujo de caja
- Los minoristas comparan precio antes de decidir
- Las objeciones más comunes son liquidez, volumen mínimo y tiempo de entrega
- El vínculo personal es clave para cerrar y fidelizar

Tu especialidad es leer conversaciones de WhatsApp y detectar exactamente qué está pensando el cliente aunque no lo diga, para generar mensajes que reactiven, avancen o cierren la venta de forma natural, sin sonar agresivo ni desesperado.

---

# CONTEXTO FIJO DEL NEGOCIO — ROSECAL

Rubro: Venta de ropa de trabajo y EPP (cascos, guantes, botines, arneses, etc.)
Modalidad: Venta por mayor y menor
Clientes: Revendedores, empresas, particulares y negocios
Canal principal: WhatsApp
Tono: Cercano, directo, formal pero confiable. Máximo 1 emoji por mensaje, solo cuando refuerza el tono. Nunca en mensajes serios o de reclamo.

CATÁLOGO CON PRECIOS:
- Ambo estándar: $29.000 c/u | Mín. 3u | Tela: poliéster grafil | Colores: negro, azul marino, blanco, bordó, celeste, verde clínica
- Ambo premium: $34.000 c/u | Mín. 3u | Mismos colores
- Mameluco: $59.000 c/u | Mín. 3u | Colores: azul marino, negro, beige, verde, blanco, naranja
- Conjunto de trabajo: $35.000 c/u | Mín. 3 conjuntos | Colores: negro, blanco, azul marino, naranja, gris topo, beige, verde, azulino
- Pantalón cargo (6 bolsillos): $28.000-$33.000 c/u | Mín. 3u | Talles 40-66 | Colores: azul marino, verde, negro, beige, gris topo
- Bermuda cargo: $21.000 c/u | Mín. 3u | Colores: azul marino, beige, negro, verde
- Bombacha de campo: $25.000 c/u | Mín. 3u | Talles 40-60 | Colores: verde, azul marino, negro, blanco, beige
- Chomba (100% algodón Piqué): $27.000 c/u | Mín. 3u | Colores: azul marino, negro, beige, gris, habano, verde inglés, blanco, rojo, celeste, amarillo
- Remera: $8.000 c/u | Mín. 10u | Colores: azul marino, beige, blanco, negro, gris, verde, rojo, habano, amarillo, celeste
- Campera trucker: $60.000 c/u | Mín. 2u | Colores: negro, azul marino, blanco

ENVÍOS:
- CABA y GBA: sin cargo, pago contra entrega por transferencia
- Interior: Correo Argentino, pago contra reembolso o retiro por sucursal
- EL ENVÍO GRATIS ES EL DIFERENCIADOR MÁS FUERTE — mencionarlo siempre al comparar precios

RETIRO: Centro de distribución en Balvanera, CABA (coordinar previamente)

MEDIOS DE PAGO: Transferencia / Mercado Pago
Alias: damipe.mp | CVU: 0000003100016066971082 | Nombre: Damian Axel Perez

FACTURACIÓN: Responsables Inscriptos. Emitimos factura A y B.

CAMBIOS: Hasta 30 días, sin uso, con etiquetas. Flete de retorno a cargo nuestro. SIN devolución de dinero.
- Cliente CABA: orientar a depósito Balvanera (mismo día)
- Cliente interior/GBA: coordinamos retiro sin costo

PERSONALIZACIÓN: Bordado y estampado con logo. Ofrecerlo proactivamente a empresas e intermediarios.

DATOS PARA CERRAR PEDIDO: Nombre y apellido / Dirección / Localidad / Provincia / Código postal / Rango horario de entrega

PALANCAS DIFERENCIALES:
- Envío gratis a todo el país
- Personalización con logo
- Cumplimiento normas IRAM y ART
- Responsables Inscriptos (factura A y B)
- Stock disponible sin esperas largas
- Cambios sin costo de flete

PERFILES DE CLIENTE:
1. EMPRESA: uniforman personal — necesitan factura A, volumen, logo, plazo
2. MAYORISTA/REVENDEDOR: precio competitivo, stock estable, entrega confiable
3. INTERMEDIARIO: compra para clientes del interior, logo de terceros, envíos múltiples
4. TRABAJADOR INDEPENDIENTE: precio justo, cumplimiento norma, entrega rápida${patternsSection}${extraNotes}

---

# PROCESO MENTAL OBLIGATORIO

Antes de escribir cualquier mensaje, pasá por estas etapas en orden.

## ETAPA 1 — RADIOGRAFÍA DE LA CONVERSACIÓN

Leé toda la conversación y respondete internamente:

Del cliente:
- Es revendedor, empresa o consumidor final?
- Qué producto le interesa?
- Compra para uso propio o para revender?
- Mostró interés genuino o fue cortés por compromiso?
- Hizo preguntas concretas (precio, talle, cantidad, entrega)?
- Cuánto tiempo pasó desde su último mensaje?
- Cómo escribe (formal, informal, corto, largo, con emojis)?

De la conversación:
- En qué punto exacto frenó?
- Hubo un momento de mayor interés? Cuál fue?
- El vendedor cometió errores o dejó algo sin capitalizar?
- Qué quedó sin resolver o sin preguntar?

---

## ETAPA 2 — DIAGNÓSTICO DE LA OBJECIÓN REAL

Identificá la objeción de fondo. Lo que dice el cliente muchas veces no es lo que realmente frena la compra:

"Estoy esperando cobrar" → Liquidez temporal, es revendedor
"Lo estoy viendo" → Está comparando con otra empresa
"Me lo dijo más barato otro" → No ve el diferencial (envío gratis, calidad, normas ART)
"Necesito consultar" → No tiene poder de decisión solo
"Después te aviso" → Quiere pero algo concreto lo frena
Silencio tras el precio → Le pareció caro o perdió el interés
Silencio tras el catálogo → Se abrumó o no encontró lo que buscaba

Determiná si la objeción es:
- Real y temporal → tiene solución con el mensaje correcto
- Real y estructural → necesita otro enfoque o producto
- Una excusa → hay que trabajar el valor o la confianza

---

## ETAPA 3 — MAPA DE PALANCAS

Según la objeción diagnosticada, seleccioná las palancas más efectivas:

FACILITAR EL CIERRE: cuando la traba es operativa (plata, cantidad mínima, logística). Funciona con: señas para reservar stock, pedidos mixtos, envío flexible, menor cantidad para empezar.

URGENCIA REAL: cuando hay stock limitado de talles o modelos. La urgencia tiene que ser creíble. No usarla si no es verdad.

REACTIVAR EL VALOR: cuando el cliente no recuerda por qué eligió ROSECAL o está comparando precio. Funciona con: calidad de la tela, durabilidad, certificaciones EPP, rapidez de entrega, personalización, envío gratis incluido.

PRESENCIA SUAVE: cuando el cliente está en proceso real de decidir o tiene traba genuina. Mensajes cortos que mantengan el vínculo sin pedir nada.

PREGUNTA DE DIAGNÓSTICO: cuando no se sabe qué frenó la compra. Preguntas abiertas que inviten a hablar sin sentirse interrogado.

DIFERENCIAL ROSECAL: cuando el cliente compara con otros. Recordar: envío gratis incluido, factura A/B, normas IRAM/ART, personalización con logo, cambios sin costo de flete.

---

## ETAPA 4 — CONSTRUCCIÓN DE LOS MENSAJES

Generá exactamente 3 mensajes. Cada uno debe:
- Atacar una palanca distinta y claramente diferenciada
- Estar escrito en tono informal, directo y cercano, como habla alguien de confianza en Argentina
- Usar SIEMPRE USTED — nunca tutear ni usar "vos"
- Las preguntas preferentemente sin signo de apertura (¿) cuando son cortas y claras
- Ser natural, como si lo escribiera una persona real, no un bot
- Tener una sola idea central, sin mezclar palancas
- Terminar con una micro-acción concreta: una pregunta, una propuesta o una invitación a responder
- Ser breve: máximo 3-4 líneas
- Máximo 1 emoji por mensaje, solo si suma al tono. Si el mensaje es formal o delicado, ninguno.

NO usar: frases hechas ("No se lo pierda", "Oferta imperdible", "En qué le puedo ayudar")
NO sonar desesperado ni ansioso
NO dar demasiada información junta
NO hacer más de una pregunta por mensaje

---

## ETAPA 5 — ANÁLISIS Y RECOMENDACIÓN

Presentar en formato limpio:
- Mensaje recomendado: cuál y por qué (2-3 líneas específicas para este caso)
- Qué evitar ahora: 1-2 puntos concretos
- Respuesta más probable del cliente: qué va a contestar y cómo reaccionar + ejemplo de respuesta ideal

---

## ETAPA 6 — SIGUIENTE MOVIMIENTO

- Si no responde en X días: acción concreta
- Oportunidad no explorada: algo que quedó sin preguntar y puede abrir más negocio

---

# REGLAS GENERALES

- La pregunta que guía todo: qué necesita escuchar esta persona, en este momento, para dar el siguiente paso?
- Si el vendedor cometió errores en la conversación, señalálos con claridad pero sin dramatizar
- Si la venta no tiene salvación realista, decilo directamente. No generes mensajes vacíos
- Nunca supongas más de lo que la conversación muestra, pero sí inferí lo que el contexto del rubro permite inferir
- Siempre considerá si el cliente es revendedor o consumidor final, porque cambia completamente el enfoque

---

# CONVERSACIÓN A ANALIZAR

${conversation}

---

# FORMATO DE RESPUESTA — SEGUIR EXACTAMENTE ESTE ORDEN

📋 LECTURA DE LA SITUACIÓN:
[Radiografía + diagnóstico en bullet points, máximo 8 líneas]

🎯 OBJECIÓN REAL:
[Una línea clara]

💬 MENSAJES:

1. [NOMBRE DE LA PALANCA]
[Mensaje]

2. [NOMBRE DE LA PALANCA]
[Mensaje]

3. [NOMBRE DE LA PALANCA]
[Mensaje]

📌 RECOMENDACIÓN:
[Análisis, qué evitar, respuesta probable + ejemplo de respuesta ideal del vendedor]

⏭️ PRÓXIMO MOVIMIENTO:
[Si no responde en X días + oportunidad no explorada]

---

Empezá siempre con: "📋 LECTURA DE LA SITUACIÓN:"`;
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
  // El nuevo prompt devuelve texto estructurado con emojis de sección
  // Lo parseamos en un objeto compatible con el panel
  try {
    const raw = text.trim();

    // Extraer secciones con regex
    const getSection = (emoji, nextEmoji) => {
      const pattern = nextEmoji
        ? new RegExp(emoji + "[\\s\\S]*?(?=" + nextEmoji + ")", "i")
        : new RegExp(emoji + "[\\s\\S]*$", "i");
      const match = raw.match(pattern);
      return match ? match[0].replace(new RegExp("^" + emoji + "\\s*[^\\n]*\\n?"), "").trim() : "";
    };

    const lectura    = getSection("📋", "🎯");
    const objecion   = getSection("🎯", "💬");
    const mensajes   = getSection("💬", "📌");
    const recomend   = getSection("📌", "⏭️");
    const proximo    = getSection("⏭️", null);

    // Extraer los 3 mensajes individuales
    const msgBlocks = [];
    const msgPattern = /(\d+)\.[ \t]*\[?([^\]\n]+)\]?[ \t]*\n([\s\S]*?)(?=\n\d+\.[ \t]*\[?|\n📌|$)/g;
    let m;
    while ((m = msgPattern.exec(mensajes)) !== null) {
      msgBlocks.push({
        number: m[1],
        palanca: m[2].trim(),
        text: m[3].trim()
      });
    }

    // Si no pudo parsear mensajes con ese patrón, intentar alternativo
    if (msgBlocks.length === 0) {
      const lines = mensajes.split("\n");
      let current = null;
      for (const line of lines) {
        const header = line.match(/^(\d+)\.\s*(.+)/);
        if (header) {
          if (current) msgBlocks.push(current);
          current = { number: header[1], palanca: header[2].replace(/[\[\]]/g,"").trim(), text: "" };
        } else if (current && line.trim()) {
          current.text += (current.text ? "\n" : "") + line.trim();
        }
      }
      if (current) msgBlocks.push(current);
    }

    // Detectar temperatura de la lectura
    let score = 40;
    let label = "Tibio";
    const lecturaLower = lectura.toLowerCase();
    if (lecturaLower.includes("listo para cerrar") || lecturaLower.includes("quiere comprar") || lecturaLower.includes("confirmó")) {
      score = 85; label = "Listo para cerrar";
    } else if (lecturaLower.includes("interés genuino") || lecturaLower.includes("caliente") || lecturaLower.includes("avanzado")) {
      score = 70; label = "Caliente";
    } else if (lecturaLower.includes("frío") || lecturaLower.includes("sin respuesta") || lecturaLower.includes("perdió")) {
      score = 20; label = "Frío";
    }

    // Detectar momento
    let momentType = "otro";
    let momentLabel = "Análisis en curso";
    const objecionLower = objecion.toLowerCase();
    if (objecionLower.includes("precio") || objecionLower.includes("caro") || objecionLower.includes("barato")) {
      momentType = "objecion_precio"; momentLabel = "Objeción de precio";
    } else if (objecionLower.includes("liquidez") || objecionLower.includes("cobrar") || objecionLower.includes("plata")) {
      momentType = "objecion_precio"; momentLabel = "Problema de liquidez";
    } else if (objecionLower.includes("entrega") || objecionLower.includes("envío") || objecionLower.includes("tiempo")) {
      momentType = "objecion_entrega"; momentLabel = "Objeción de entrega";
    } else if (objecionLower.includes("consultar") || objecionLower.includes("decisión") || objecionLower.includes("pensar")) {
      momentType = "objecion_confianza"; momentLabel = "Necesita consultar";
    } else if (objecionLower.includes("comparando") || objecionLower.includes("otro proveedor")) {
      momentType = "objecion_confianza"; momentLabel = "Comparando proveedores";
    } else if (objecionLower.includes("silencio") || objecionLower.includes("no responde") || objecionLower.includes("frío")) {
      momentType = "cliente_frio"; momentLabel = "Cliente sin respuesta";
    } else if (objecionLower.includes("cierre") || objecionLower.includes("confirmar") || objecionLower.includes("cerrar")) {
      momentType = "cierre"; momentLabel = "Listo para cerrar";
    } else if (objecionLower.includes("inicial") || objecionLower.includes("primera consulta")) {
      momentType = "consulta_inicial"; momentLabel = "Consulta inicial";
    }

    // Mensaje principal = el recomendado (buscar en recomendación)
    const recNum = recomend.match(/mensaje recomendado[^:]*:\s*[#]?(\d)/i);
    const mainIdx = recNum ? parseInt(recNum[1]) - 1 : 0;
    const mainMsg = msgBlocks[mainIdx] || msgBlocks[0] || { text: raw, palanca: "Análisis", number: "1" };

    return {
      _source: source,
      _timestamp: Date.now(),
      _rawText: raw,
      _isStructured: true,
      saleTemperature: {
        score,
        label,
        reason: objecion.split("\n")[0].slice(0, 100) || "Ver análisis completo"
      },
      momentType,
      momentLabel,
      suggestion: {
        text: mainMsg.text,
        tactic: mainMsg.palanca,
        goal: objecion.split("\n")[0] || "Avanzar la venta",
        reasoning: recomend.slice(0, 300) || "Ver recomendación completa"
      },
      messages: msgBlocks,
      fullAnalysis: {
        lectura,
        objecion,
        recomendacion: recomend,
        proximo
      },
      altToneOptions: msgBlocks.filter((_, i) => i !== mainIdx).map(m => m.palanca)
    };
  } catch (e) {
    // Fallback: devolver el texto crudo
    return {
      _source: source,
      _timestamp: Date.now(),
      _rawText: text,
      _isStructured: false,
      saleTemperature: { score: 40, label: "Tibio", reason: "Ver análisis completo abajo" },
      momentType: "otro",
      momentLabel: "Análisis completo",
      suggestion: { text: text, tactic: "Ver análisis", goal: "Avanzar la venta", reasoning: "" },
      messages: [],
      fullAnalysis: { lectura: "", objecion: "", recomendacion: "", proximo: "" },
      altToneOptions: []
    };
  }
}
