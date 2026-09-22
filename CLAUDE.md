# NeuroSec Radar

Agregador personal de noticias de **IA**, **ciberseguridad** e **IA × ciberseguridad** (en ambos sentidos).
Autor: Ricardo (GitHub `yConFi`). Repo: `yConFi/neurosec-radar` (**público**, también servirá de portfolio).

## Reglas de trabajo
- Responde siempre en **español**. En el código (nombres, commits) puedes usar inglés.
- No inventes ni des nada por hecho: si hay una duda, **pregunta**. Comprueba precios, límites y APIs en la documentación oficial actual antes de usarlos.
- **Nunca** pongas secretos en el código ni los pidas en el chat. Van en GitHub Secrets o en las variables de entorno de Vercel. Mantén `.env.example` sin valores.
- Trabaja por fases y enséñame el resultado de cada una antes de pasar a la siguiente.

## Decisiones cerradas
| Tema | Decisión |
|---|---|
| Temas | Vulnerabilidades/CVEs, ataques y brechas, IA (modelos y empresas), IA×Ciber (prompt injection, seguridad de LLMs, IA ofensiva/defensiva, herramientas, CTFs, recursos) |
| Idioma | Resúmenes en español manteniendo los términos técnicos en inglés + enlace a la fuente original |
| Recogida | GitHub Actions cada 30 min (Vercel Hobby solo permite cron diario con ±59 min) |
| IA | API de Anthropic, **Claude Haiku 4.5** vía **Message Batches API** (−50 %; resultados en ~30–60 min). Presupuesto orientativo: 4–8 $/mes |
| arXiv | Solo "Announce Type: new" + palabras clave (`config/settings.yaml`), ~35–40 papers/día |
| Base de datos | Supabase (plan Free: 500 MB; pausa el proyecto tras 1 semana sin actividad). Proyecto `neurosec-radar`, región eu-west-3 |
| Web | Next.js en Vercel (Hobby), login con Supabase Auth, **un único usuario** (Ricardo) |
| Avisos | **Sin avisos push ni Telegram.** Lo importante se ve en la web: **destacado** (`importance` = 8) en una sección sobre el feed y **trascendental** (`importance` ≥ 9) en un banner fijo hasta marcarlo como leído. Solo cuenta la IA (columna generada `articles.highlight`) |
| Web: interacción | Leído / favoritos / notas, búsqueda y filtros (tema, fecha, importancia, fuente, CVE), chat con la IA sobre cada noticia y resumen semanal |

## Arquitectura
1. **Recolector (Python)**: RSS de medios de ciberseguridad e IA en inglés y en español (p. ej. Hispasec/Una al día, INCIBE-CERT), CISA KEV (JSON), NVD API (solo CVEs críticos), arXiv (cs.CR, cs.AI) y blogs oficiales de laboratorios de IA. Hay que verificar que cada feed existe y funciona antes de añadirlo.
2. **Procesado**: normalización, deduplicación (URL + similitud de título) y Haiku con salida JSON: `category` (ai | cyber | ai_x_cyber), `subtopics`, `importance` 1–10, `is_curious`, `summary_es`, `cves[]`, `is_urgent` + `urgent_reason`.
3. **Destacados**: `articles.highlight` = `'major'` (importance ≥ 9) o `'top'` (importance = 8), calculado por Postgres. KEV/NVD aportan datos de CVE (tabla `vulnerabilities`) pero no generan destacados.
4. **Web (Next.js)**: banner de trascendentales, sección de destacados, etiqueta **«Acción requerida»** cuando `is_urgent` (con `urgent_reason` como explicación), feed, filtros, detalle de la noticia, notas, favoritos, chat (ruta de API que llama a Claude con el contexto de la noticia), resumen semanal. Row Level Security activado en todas las tablas.

## Fases
1. Recolector + procesado + esquema de Supabase (migraciones SQL).
2. Web: banner de trascendentales + destacados, feed, filtros, leído/favoritos/notas, login.
3. Chat con la IA + resumen semanal.

(La antigua fase de Telegram se descartó el 2026-09-23.)
Extra: README cuidado para el portfolio (arquitectura, capturas, decisiones de seguridad).

## Lo que prepara Ricardo
- API key de Anthropic (console.anthropic.com, con saldo).
- Repo vacío `yConFi/neurosec-radar`.
- Cuentas de Supabase y Vercel.
