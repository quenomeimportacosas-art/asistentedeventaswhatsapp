# Sales Copilot — Asistente de Ventas para WhatsApp Web

> Copiloto de ventas en tiempo real. Lee tu conversación de WhatsApp y sugiere la mejor respuesta para cerrar más ventas.

---

## ¿Qué hace?

- **Lee el chat activo** de WhatsApp Web sin enviar nada automáticamente
- **Analiza el momento de venta**: objeción, cierre, upsell, cliente frío
- **Muestra un termómetro** de probabilidad de cierre (0–100%)
- **Sugiere la mejor respuesta** lista para copiar y pegar
- **Explica por qué** eligió esa táctica y qué busca lograr
- **Aprende** de cada conversación para mejorar con el tiempo
- **Funciona con Grok** (gratis) y **OpenRouter** como backup automático

---

## Instalación

### 1. Descargar o clonar el repositorio

```bash
git clone https://github.com/quenomeimportacosas-art/asistentedeventaswhatsapp.git
```

### 2. Cargar en Chrome

1. Abrí Chrome y andá a `chrome://extensions`
2. Activá **Modo desarrollador** (toggle arriba a la derecha)
3. Hacé click en **"Cargar descomprimida"**
4. Seleccioná la carpeta del proyecto
5. La extensión aparece en la barra de Chrome

### 3. Abrir en WhatsApp Web

1. Andá a [web.whatsapp.com](https://web.whatsapp.com)
2. Hacé click en el ícono de Sales Copilot en la barra de extensiones
3. El panel lateral se abre al lado del chat

---

## Configuración inicial

### API Keys (gratis)

**Groq (recomendado — gratis):**
1. Andá a [console.groq.com](https://console.groq.com)
2. Creá una cuenta
3. Generá una API key
4. Pegala en el campo **Grok API Key** en ⚙ Configuración

**OpenRouter (backup gratuito):**
1. Andá a [openrouter.ai](https://openrouter.ai)
2. Creá una cuenta
3. Generá una API key
4. Pegala en **OpenRouter API Key**

> La app usa Grok primero. Si falla (límite diario, error), cambia automáticamente a OpenRouter.

### Perfil del negocio

Completá los campos en ⚙ Configuración:
- Nombre del negocio
- Qué vendés y a qué precios
- Tiempo de entrega
- Política de devoluciones
- Tono de la marca
- Objeciones frecuentes (¡esto es clave para la calidad!)

---

## Cómo usarlo

1. **Abrí un chat** en WhatsApp Web
2. **Leé la conversación** con el cliente
3. **Presioná "Analizar conversación"** cuando necesitás una sugerencia
4. El panel muestra:
   - Termómetro de venta con porcentaje y razón
   - Momento detectado (objeción, cierre, etc.)
   - Sugerencia lista para copiar
   - Táctica usada y por qué
5. **Copiá** el texto y pegalo en WhatsApp
6. Si querés otra variante, usá los botones de tono (más empático, más directo, con urgencia)
7. Cuando cerrás una venta, presioná **"✓ Venta cerrada"** para que la app aprenda

---

## Estructura del proyecto

```
asistentedeventaswhatsapp/
├── manifest.json              # Config de la extensión Chrome
├── icons/                     # Íconos (16, 32, 48, 128px)
├── src/
│   ├── background/
│   │   └── background.js      # Service worker — llama a las APIs de IA
│   ├── content/
│   │   └── content.js         # Lee el DOM de WhatsApp Web
│   └── panel/
│       ├── panel.html         # Interfaz del side panel
│       ├── panel.css          # Estilos
│       └── panel.js           # Lógica del panel
└── README.md
```

---

## APIs soportadas

| API | Modelo | Costo | Uso |
|-----|--------|-------|-----|
| Groq (groq.com) | llama3-70b-8192 | Gratis (con límites) | Principal |
| OpenRouter | mistral-7b-instruct | Gratis | Backup automático |

---

## Roadmap

- [x] **Fase 1** — MVP: leer chat + analizar + sugerir ← *estás aquí*
- [ ] **Fase 2** — Termómetro avanzado + carga de catálogo PDF/Excel
- [ ] **Fase 3** — Loop de aprendizaje completo con estadísticas
- [ ] **Fase 4** — Backend, multi-dispositivo, patrones por rubro

---

## Privacidad

- Todo el procesamiento es local excepto la llamada a la API de IA
- Las conversaciones **nunca se guardan en servidores propios**
- El historial de patrones se guarda en `chrome.storage.local` (solo en tu Chrome)
- Las API keys se guardan localmente, nunca se envían a terceros

---

*Construido para e-commerce · Argentina 🇦🇷*
