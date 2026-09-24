// Presentation helpers (Spanish UI, Europe/Madrid time).

export const CATEGORY_LABEL: Record<string, string> = {
  cyber: "Ciber",
  ai: "IA",
  ai_x_cyber: "IA × Ciber",
}

export const SUBTOPIC_LABEL: Record<string, string> = {
  vulnerability: "Vulnerabilidad",
  exploit: "Exploit",
  zero_day: "Zero-day",
  attack_breach: "Ataque / brecha",
  ransomware: "Ransomware",
  malware: "Malware",
  threat_actor: "Actor de amenaza",
  phishing_fraud: "Phishing / fraude",
  patch_update: "Parche",
  privacy: "Privacidad",
  policy_regulation: "Regulación",
  ai_model_release: "Nuevo modelo",
  ai_company: "Empresa de IA",
  ai_research: "Investigación",
  ai_product: "Producto de IA",
  prompt_injection: "Prompt injection",
  jailbreak: "Jailbreak",
  llm_security: "Seguridad LLM",
  ai_supply_chain: "Supply chain IA",
  offensive_ai: "IA ofensiva",
  defensive_ai: "IA defensiva",
  security_tool: "Herramienta",
  ctf: "CTF",
  learning_resource: "Recurso",
}

const dateFmt = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" })

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : ""
}

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ""
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 48) return rtf.format(hours, "hour")
  return formatDate(iso)
}

export type Figure = { url: string; caption: string }

/** articles.figures is untyped jsonb: keep only well-formed https entries. */
export function parseFigures(value: unknown): Figure[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((f) =>
    f && typeof f === "object" && typeof f.url === "string" && typeof f.caption === "string" &&
    safeUrl(f.url)?.startsWith("https://")
      ? [{ url: f.url, caption: f.caption }]
      : [],
  )
}

/** Feed URLs are third-party data: only allow http(s) links (blocks javascript:, data:, ...). */
export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}
