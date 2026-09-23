import Link from "next/link"

import { markAllBannerRead, setRead } from "@/app/actions"
import { ArticleCard } from "@/components/article-card"
import { ActionRequired } from "@/components/badges"
import { FiltersForm } from "@/components/filters"
import { Header } from "@/components/header"
import { PAGE_SIZE, getBanner, getFeed, getHighlights, getSources, hasActiveFilters, parseFilters } from "@/lib/feed"
import { safeUrl, timeAgo } from "@/lib/format"
import { requireUser } from "@/lib/supabase/server"

export default async function Home({ searchParams }: PageProps<"/">) {
  const { supabase, email } = await requireUser()
  const filters = parseFilters(await searchParams)
  const filtering = hasActiveFilters(filters)

  const [banner, highlights, feed, sources] = await Promise.all([
    getBanner(supabase),
    filtering ? Promise.resolve([]) : getHighlights(supabase),
    getFeed(supabase, filters),
    getSources(supabase),
  ])

  const pageHref = (page: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) if (v && k !== "page") params.set(k, String(v))
    if (page) params.set("page", String(page))
    const qs = params.toString()
    return qs ? `/?${qs}` : "/"
  }
  const lastPage = Math.max(0, Math.ceil(feed.total / PAGE_SIZE) - 1)

  return (
    <>
      <Header email={email} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        {banner.items.length > 0 && (
          <section
            aria-label="Trascendental"
            className="rounded-xl border-2 border-red-600 bg-red-50 p-4 dark:border-red-500 dark:bg-red-950/40"
          >
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
                ● Trascendental {banner.total > banner.items.length && `(${banner.total})`}
              </h2>
              <form action={markAllBannerRead} className="ml-auto">
                <input type="hidden" name="ids" value={banner.items.map((i) => i.id).join(",")} />
                <button type="submit" className="text-xs text-red-700 hover:underline dark:text-red-300">
                  Marcar todo como leído
                </button>
              </form>
            </div>
            <ul className="mt-3 space-y-3">
              {banner.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  <span className="mt-0.5 font-mono text-sm font-bold text-red-700 dark:text-red-300">
                    {item.importance}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/article/${item.id}`} className="font-semibold hover:underline">
                      {item.title}
                    </Link>
                    <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">{item.summary_es}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {item.is_urgent && <ActionRequired reason={item.urgent_reason} />}
                      <span>
                        {item.source_name} · {timeAgo(item.sort_at)}
                      </span>
                      {safeUrl(item.url) && (
                        <a href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                          Fuente ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <form action={setRead}>
                    <input type="hidden" name="id" value={item.id!} />
                    <input type="hidden" name="read" value="1" />
                    <button
                      type="submit"
                      className="rounded-md border border-red-600/40 px-2 py-1 text-xs text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
                    >
                      Leído
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        {highlights.length > 0 && (
          <section aria-label="Destacados">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">
              Destacados · últimas 48 h
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {highlights.map((item) => (
                <ArticleCard key={item.id} item={item} compact />
              ))}
            </div>
          </section>
        )}

        <section aria-label="Noticias" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">
              {filtering ? "Resultados" : "Últimas noticias"}
            </h2>
            <span className="text-xs text-zinc-500">{feed.total} noticias</span>
          </div>
          <FiltersForm filters={filters} sources={sources} />
          {feed.items.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">No hay noticias con estos filtros.</p>
          ) : (
            <div className="space-y-3">
              {feed.items.map((item) => (
                <ArticleCard key={item.id} item={item} />
              ))}
            </div>
          )}
          {lastPage > 0 && (
            <nav className="flex items-center justify-between pt-2 text-sm">
              {filters.page > 0 ? (
                <Link href={pageHref(filters.page - 1)} className="hover:underline">
                  ← Más recientes
                </Link>
              ) : (
                <span />
              )}
              <span className="text-zinc-500">
                Página {filters.page + 1} de {lastPage + 1}
              </span>
              {filters.page < lastPage ? (
                <Link href={pageHref(filters.page + 1)} className="hover:underline">
                  Más antiguas →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      </main>
    </>
  )
}
