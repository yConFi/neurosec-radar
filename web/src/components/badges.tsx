import { CATEGORY_LABEL, SUBTOPIC_LABEL } from "@/lib/format"

const CATEGORY_STYLE: Record<string, string> = {
  cyber: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  ai: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  ai_x_cyber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
}

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  return <span className={`${pill} ${CATEGORY_STYLE[category] ?? ""}`}>{CATEGORY_LABEL[category] ?? category}</span>
}

export function ImportanceBadge({ importance }: { importance: number | null }) {
  if (importance == null) return null
  const style =
    importance >= 9
      ? "bg-red-600 text-white"
      : importance === 8
        ? "bg-orange-500 text-white"
        : importance >= 6
          ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  return (
    <span className={`${pill} ${style} font-mono tabular-nums`} title="Importancia (1-10)">
      {importance}
    </span>
  )
}

export function ActionRequired({ reason }: { reason: string | null }) {
  return (
    <span
      className={`${pill} border border-red-600/40 bg-red-50 text-red-700 dark:border-red-400/40 dark:bg-red-950/60 dark:text-red-300`}
      title={reason ?? undefined}
    >
      ⚠ Acción requerida
    </span>
  )
}

/** The concrete action behind «Acción requerida» (product + fixed version or mitigation). */
export function ActionText({ reason, className = "" }: { reason: string | null; className?: string }) {
  if (!reason) return null
  return <p className={`text-sm font-medium text-red-700 dark:text-red-300 ${className}`}>→ {reason}</p>
}

export function SubtopicList({ subtopics }: { subtopics: string[] | null }) {
  if (!subtopics?.length) return null
  return (
    <>
      {subtopics.map((s) => (
        <span key={s} className="text-xs text-zinc-500 dark:text-zinc-400">
          #{SUBTOPIC_LABEL[s] ?? s}
        </span>
      ))}
    </>
  )
}
