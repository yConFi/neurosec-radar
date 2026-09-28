import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

type Client = SupabaseClient<Database>

export type Digest = {
  headline: string
  overview: string
  top: { id: number; why: string }[]
  sections: { category: string; points: { text: string; ids: number[] }[] }[]
  trends: string[]
}

export type DigestArticle = { id: number; title: string; source_name: string | null; importance: number | null; read_at: string | null }

const isStr = (v: unknown): v is string => typeof v === "string"
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0

/** weekly_digests.content is untyped jsonb (validated by the collector): re-check its shape. */
export function parseDigest(value: unknown): Digest | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (!isStr(v.headline) || !isStr(v.overview)) return null
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
  return {
    headline: v.headline,
    overview: v.overview,
    top: arr(v.top).flatMap((t) => {
      const o = t as Record<string, unknown>
      return o && isId(o.id) && isStr(o.why) ? [{ id: o.id, why: o.why }] : []
    }),
    sections: arr(v.sections).flatMap((s) => {
      const o = s as Record<string, unknown>
      if (!o || !isStr(o.category)) return []
      const points = arr(o.points).flatMap((p) => {
        const q = p as Record<string, unknown>
        return q && isStr(q.text) ? [{ text: q.text, ids: arr(q.ids).filter(isId) }] : []
      })
      return points.length ? [{ category: o.category, points }] : []
    }),
    trends: arr(v.trends).filter(isStr),
  }
}

/** Weeks with a digest, newest first (for the selector). */
export async function listDigests(supabase: Client) {
  const { data, error } = await supabase
    .from("weekly_digests")
    .select("week_start,status,article_count")
    .order("week_start", { ascending: false })
    .limit(52)
  if (error) throw error
  return data ?? []
}

export async function getDigest(supabase: Client, weekStart: string) {
  const { data, error } = await supabase
    .from("weekly_digests")
    .select("week_start,status,article_count,content,generated_at,model")
    .eq("week_start", weekStart)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const digest = parseDigest(data.content)
  const ids = digest
    ? [...new Set([...digest.top.map((t) => t.id), ...digest.sections.flatMap((s) => s.points.flatMap((p) => p.ids))])]
    : []
  let articles = new Map<number, DigestArticle>()
  if (ids.length) {
    const res = await supabase.from("feed").select("id,title,source_name,importance,read_at").in("id", ids)
    if (res.error) throw res.error
    articles = new Map((res.data ?? []).map((a) => [a.id!, a as DigestArticle]))
  }
  return { row: data, digest, articles }
}

const weekFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" })
const yearFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

/** "21 – 27 de septiembre de 2026" style label for a Monday (YYYY-MM-DD). */
export function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`)
  const end = new Date(start.getTime() + 6 * 86_400_000)
  return `${weekFmt.format(start)} – ${yearFmt.format(end)}`
}
