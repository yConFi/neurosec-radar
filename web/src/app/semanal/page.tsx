import Link from "next/link"
import { notFound } from "next/navigation"

import { CategoryBadge, ImportanceBadge } from "@/components/badges"
import { Header } from "@/components/header"
import { formatDate } from "@/lib/format"
import { getViewer } from "@/lib/supabase/server"
import { type DigestArticle, getDigest, listDigests, weekLabel } from "@/lib/weekly"

function ArticleLink({ article }: { article: DigestArticle | undefined }) {
  if (!article) return null
  return (
    <Link href={`/article/${article.id}`} className={`min-w-0 hover:underline ${article.read_at ? "text-zinc-500" : ""}`}>
      {article.title}
    </Link>
  )
}

export default async function WeeklyPage({ searchParams }: PageProps<"/semanal">) {
  const { supabase, user } = await getViewer()
  const owner = Boolean(user)
  const raw = (await searchParams).semana
  const requested = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null

  const weeks = await listDigests(supabase)
  const weekStart = requested ?? weeks.find((w) => w.status === "done")?.week_start ?? weeks[0]?.week_start
  const result = weekStart ? await getDigest(supabase, weekStart, owner) : null
  if (requested && !result) notFound()

  return (
    <>
      <Header email={user?.email} signedIn={owner} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Resumen semanal</h1>
          {weeks.length > 1 && (
            <nav aria-label="Semanas" className="ml-auto flex flex-wrap gap-2 text-xs">
              {weeks.slice(0, 8).map((w) => (
                <Link
                  key={w.week_start}
                  href={`/semanal?semana=${w.week_start}`}
                  aria-current={w.week_start === weekStart ? "page" : undefined}
                  className={`rounded-full border px-2 py-0.5 ${
                    w.week_start === weekStart
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {w.week_start.slice(5).split("-").reverse().join("/")}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {!result ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            Todavía no hay resúmenes. El primero se genera el lunes por la mañana con las noticias de la semana anterior.
          </p>
        ) : (
          <WeeklyDigest result={result} />
        )}
      </main>
    </>
  )
}

function WeeklyDigest({ result }: { result: NonNullable<Awaited<ReturnType<typeof getDigest>>> }) {
  const { row, digest, articles } = result
  const label = weekLabel(row.week_start)

  if (row.status !== "done" || !digest) {
    const message =
      row.status === "queued"
        ? "Se está generando (la IA tarda entre unos minutos y una hora). Vuelve más tarde."
        : row.status === "failed"
          ? "No se ha podido generar. El recolector lo reintentará automáticamente."
          : `No hubo noticias suficientes esa semana (${row.article_count}) para hacer un resumen.`
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Semana del {label}</h2>
        <p className="text-sm text-zinc-500">{message}</p>
      </section>
    )
  }

  const paragraphs = digest.overview.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-zinc-500">Semana del {label}</p>
        <h2 className="text-2xl font-bold leading-tight">{digest.headline}</h2>
        <p className="text-xs text-zinc-500">
          {row.article_count} noticias analizadas · generado {formatDate(row.generated_at)}
        </p>
      </header>

      <div className="space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {digest.top.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400">Lo más importante</h3>
          <ol className="space-y-3">
            {digest.top.map((t, i) => {
              const a = articles.get(t.id)
              return (
                <li key={t.id} className="flex gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="font-mono text-sm font-bold text-zinc-400">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start gap-2 text-sm font-semibold">
                      <ImportanceBadge importance={a?.importance ?? null} />
                      <ArticleLink article={a} />
                    </div>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{t.why}</p>
                    {a?.source_name && <p className="text-xs text-zinc-500">{a.source_name}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {digest.sections.map((s) => (
        <section key={s.category} className="space-y-2">
          <CategoryBadge category={s.category} />
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {s.points.map((p, i) => (
              <li key={i}>
                {p.text}{" "}
                <span className="text-xs text-zinc-500">
                  {p.ids.map((id, j) => {
                    const a = articles.get(id)
                    return a ? (
                      <Link key={id} href={`/article/${id}`} title={a.title} className="hover:underline">
                        [{j + 1}]
                      </Link>
                    ) : null
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {digest.trends.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Tendencias</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {digest.trends.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
