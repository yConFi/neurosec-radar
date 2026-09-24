import Link from "next/link"

import { ActionRequired, ActionText, CategoryBadge, ImportanceBadge, SubtopicList } from "@/components/badges"
import { ExternalImage } from "@/components/external-image"
import { FavoriteButton, ReadButton } from "@/components/state-buttons"
import type { Card } from "@/lib/feed"
import { safeUrl, timeAgo } from "@/lib/format"

export function ArticleCard({ item, compact = false }: { item: Card; compact?: boolean }) {
  const id = item.id!
  const read = Boolean(item.read_at)
  const external = safeUrl(item.url)

  return (
    <article
      className={`overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${
        read ? "opacity-60" : ""
      }`}
    >
      {compact && (
        <ExternalImage src={item.image_url} alt="" className="-mx-4 -mt-4 mb-3 h-32 w-[calc(100%+2rem)] max-w-none object-cover" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ImportanceBadge importance={item.importance} />
        <CategoryBadge category={item.category} />
        {item.is_urgent && <ActionRequired reason={item.urgent_reason} />}
        {item.is_curious && (
          <span className="text-xs" title="Curioso">
            ✨
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {item.source_name} · <time dateTime={item.sort_at ?? undefined}>{timeAgo(item.sort_at)}</time>
        </span>
      </div>

      <div className="mt-2 flex gap-4">
        <div className="min-w-0 flex-1">
          <h3 className={`font-semibold leading-snug ${compact ? "text-base" : "text-lg"}`}>
            <Link href={`/article/${id}`} className="hover:underline">
              {item.title}
            </Link>
          </h3>

          {!compact && item.summary_es && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{item.summary_es}</p>
          )}
          {item.is_urgent && <ActionText reason={item.urgent_reason} className="mt-2" />}
        </div>
        {!compact && (
          <ExternalImage
            src={item.image_url}
            alt=""
            className="h-16 w-24 shrink-0 rounded-lg object-cover sm:h-24 sm:w-36"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <SubtopicList subtopics={item.subtopics} />
        {item.cves?.map((cve) => (
          <Link
            key={cve}
            href={`/?cve=${encodeURIComponent(cve)}`}
            className="font-mono text-xs text-sky-700 hover:underline dark:text-sky-400"
          >
            {cve}
          </Link>
        ))}
        {item.note && <span className="text-xs text-zinc-500" title={item.note}>📝 Nota</span>}
        <div className="ml-auto flex items-center gap-1">
          {external && (
            <a
              href={external}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-zinc-200 dark:text-sky-400 dark:hover:bg-zinc-800"
            >
              Fuente ↗
            </a>
          )}
          <FavoriteButton id={id} favorite={Boolean(item.favorite)} />
          <ReadButton id={id} read={read} />
        </div>
      </div>
    </article>
  )
}
