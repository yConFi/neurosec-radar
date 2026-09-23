import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, FeedRow } from "@/lib/database.types"

type Client = SupabaseClient<Database>

export const PAGE_SIZE = 30
const CARD_COLUMNS =
  "id,url,title,sort_at,source_id,source_name,category,subtopics,importance,highlight," +
  "is_curious,summary_es,cves,is_urgent,urgent_reason,read_at,favorite,note"

export const PERIODS = {
  "24h": { label: "Últimas 24 h", hours: 24 },
  "48h": { label: "Últimas 48 h", hours: 48 },
  "7d": { label: "Últimos 7 días", hours: 24 * 7 },
  "30d": { label: "Últimos 30 días", hours: 24 * 30 },
  all: { label: "Todo", hours: null },
} as const

export type Filters = {
  q: string
  cat: "" | "ai" | "cyber" | "ai_x_cyber"
  imp: number
  src: string
  cve: string
  period: keyof typeof PERIODS
  estado: "" | "unread" | "fav"
  page: number
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? ""

/** Parse and whitelist URL search params (they are user input). */
export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const cat = one(sp.cat)
  const period = one(sp.period)
  const estado = one(sp.estado)
  const imp = Number.parseInt(one(sp.imp), 10)
  const page = Number.parseInt(one(sp.page), 10)
  const cve = one(sp.cve).toUpperCase()
  return {
    q: one(sp.q).slice(0, 200),
    cat: cat === "ai" || cat === "cyber" || cat === "ai_x_cyber" ? cat : "",
    imp: Number.isFinite(imp) && imp >= 1 && imp <= 10 ? imp : 0,
    src: /^[a-z0-9][a-z0-9_-]*$/.test(one(sp.src)) ? one(sp.src) : "",
    cve: /^CVE-\d{4}-\d{4,}$/.test(cve) ? cve : "",
    period: period in PERIODS ? (period as Filters["period"]) : "all",
    estado: estado === "unread" || estado === "fav" ? estado : "",
    page: Number.isFinite(page) && page > 0 ? page : 0,
  }
}

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.q || f.cat || f.imp || f.src || f.cve || f.estado || f.period !== "all")
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

export type Card = Pick<
  FeedRow,
  | "id" | "url" | "title" | "sort_at" | "source_id" | "source_name" | "category" | "subtopics"
  | "importance" | "highlight" | "is_curious" | "summary_es" | "cves" | "is_urgent"
  | "urgent_reason" | "read_at" | "favorite" | "note"
>

/** Transcendental items stay pinned until marked as read. */
export async function getBanner(supabase: Client) {
  const { data, error, count } = await supabase
    .from("feed")
    .select(CARD_COLUMNS, { count: "exact" })
    .eq("highlight", "major")
    .is("read_at", null)
    .order("sort_at", { ascending: false })
    .limit(5)
  if (error) throw error
  return { items: (data ?? []) as unknown as Card[], total: count ?? 0 }
}

/** Highlights (importance 8) from the last 48 h, read or not. */
export async function getHighlights(supabase: Client) {
  const { data, error } = await supabase
    .from("feed")
    .select(CARD_COLUMNS)
    .eq("highlight", "top")
    .gte("sort_at", hoursAgo(48))
    .order("sort_at", { ascending: false })
    .limit(8)
  if (error) throw error
  return (data ?? []) as unknown as Card[]
}

export async function getFeed(supabase: Client, f: Filters) {
  let query = supabase.from("feed").select(CARD_COLUMNS, { count: "exact" })

  if (f.q) query = query.textSearch("search", f.q, { type: "websearch", config: "simple" })
  if (f.cat) query = query.eq("category", f.cat)
  if (f.imp) query = query.gte("importance", f.imp)
  if (f.src) query = query.eq("source_id", f.src)
  if (f.cve) query = query.contains("cves", [f.cve])
  const hours = PERIODS[f.period].hours
  if (hours) query = query.gte("sort_at", hoursAgo(hours))
  if (f.estado === "unread") query = query.is("read_at", null)
  if (f.estado === "fav") query = query.eq("favorite", true)

  const from = f.page * PAGE_SIZE
  const { data, error, count } = await query
    .order("sort_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1)
  if (error) throw error
  return { items: (data ?? []) as unknown as Card[], total: count ?? 0 }
}

export async function getSources(supabase: Client) {
  const { data, error } = await supabase.from("sources").select("id,name").eq("enabled", true).order("name")
  if (error) throw error
  return data ?? []
}

export async function getArticle(supabase: Client, id: number) {
  const { data, error } = await supabase.from("feed").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  if (!data) return null

  const cves = data.cves ?? []
  const [vulns, alsoIn] = await Promise.all([
    cves.length
      ? supabase.from("vulnerabilities").select("*").in("cve_id", cves)
      : Promise.resolve({ data: [], error: null }),
    // Near-duplicates found by the collector ("also covered by ...")
    supabase.from("articles").select("id,url,title,source_id").eq("duplicate_of", id),
  ])
  if (vulns.error) throw vulns.error
  if (alsoIn.error) throw alsoIn.error
  return { article: data, vulnerabilities: vulns.data ?? [], alsoIn: alsoIn.data ?? [] }
}
