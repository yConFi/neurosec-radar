import Link from "next/link"
import { notFound } from "next/navigation"

import { saveNote } from "@/app/actions"
import { ActionRequired, CategoryBadge, ImportanceBadge, SubtopicList } from "@/components/badges"
import { Header } from "@/components/header"
import { FavoriteButton, ReadButton } from "@/components/state-buttons"
import { getArticle } from "@/lib/feed"
import { formatDate, safeUrl } from "@/lib/format"
import { requireUser } from "@/lib/supabase/server"

export default async function ArticlePage({ params }: PageProps<"/article/[id]">) {
  const { id: rawId } = await params
  const id = Number(rawId)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()

  const { supabase, email } = await requireUser()
  const result = await getArticle(supabase, id)
  if (!result) notFound()
  const { article: a, vulnerabilities, alsoIn } = result
  const external = safeUrl(a.url)

  return (
    <>
      <Header email={email} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Volver
        </Link>

        <article className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ImportanceBadge importance={a.importance} />
            <CategoryBadge category={a.category} />
            {a.is_curious && <span className="text-xs">✨ Curioso</span>}
          </div>
          <h1 className="text-2xl font-bold leading-tight">{a.title}</h1>
          <p className="text-sm text-zinc-500">
            {a.source_name} · {formatDate(a.sort_at)}
          </p>

          {a.is_urgent && (
            <div className="rounded-lg border border-red-600/40 bg-red-50 p-3 text-sm dark:bg-red-950/40">
              <ActionRequired reason={null} />
              <p className="mt-2 text-red-800 dark:text-red-200">{a.urgent_reason}</p>
            </div>
          )}

          <p className="text-base leading-relaxed">{a.summary_es}</p>

          <div className="flex flex-wrap items-center gap-3">
            <SubtopicList subtopics={a.subtopics} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {external && (
              <a
                href={external}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Leer en la fuente ↗
              </a>
            )}
            <FavoriteButton id={id} favorite={Boolean(a.favorite)} />
            <ReadButton id={id} read={Boolean(a.read_at)} />
          </div>
        </article>

        {vulnerabilities.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">CVE</h2>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {vulnerabilities.map((v) => (
                <li key={v.cve_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${v.cve_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {v.cve_id}
                  </a>
                  {v.cvss_score != null && (
                    <span className="font-mono">
                      CVSS {v.cvss_score} <span className="text-zinc-500">v{v.cvss_version}</span>
                    </span>
                  )}
                  {v.in_kev && (
                    <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                      CISA KEV{v.kev_date_added ? ` · ${v.kev_date_added}` : ""}
                    </span>
                  )}
                  {v.kev_ransomware && <span className="text-xs text-red-600">ransomware</span>}
                  {v.has_public_exploit && <span className="text-xs text-orange-600">exploit público</span>}
                  {(v.vendor || v.product) && (
                    <span className="text-zinc-500">{[v.vendor, v.product].filter(Boolean).join(" · ")}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {alsoIn.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">También en</h2>
            <ul className="space-y-1 text-sm">
              {alsoIn.map((d) => (
                <li key={d.id}>
                  <a href={safeUrl(d.url)} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                    {d.source_id}: {d.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Mi nota</h2>
          <form action={saveNote} className="space-y-2">
            <input type="hidden" name="id" value={id} />
            <textarea
              name="note"
              defaultValue={a.note ?? ""}
              rows={5}
              maxLength={10000}
              placeholder="Apuntes, ideas, qué revisar…"
              className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Guardar nota
            </button>
          </form>
        </section>
      </main>
    </>
  )
}
