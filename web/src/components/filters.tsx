import Link from "next/link"

import { PERIODS, type Filters } from "@/lib/feed"
import { CATEGORY_LABEL } from "@/lib/format"

const field =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"

// GET form: filters live in the URL (shareable, back button works, no client JS).
export function FiltersForm({ filters, sources }: { filters: Filters; sources: { id: string; name: string }[] }) {
  return (
    <form method="get" action="/" className="flex flex-wrap items-end gap-2">
      <input
        type="search"
        name="q"
        defaultValue={filters.q}
        placeholder="Buscar…"
        aria-label="Buscar"
        className={`${field} min-w-48 flex-1`}
      />
      <select name="cat" defaultValue={filters.cat} aria-label="Tema" className={field}>
        <option value="">Todos los temas</option>
        {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select name="imp" defaultValue={filters.imp || ""} aria-label="Importancia mínima" className={field}>
        <option value="">Cualquier importancia</option>
        {[5, 6, 7, 8, 9].map((n) => (
          <option key={n} value={n}>
            ≥ {n}
          </option>
        ))}
      </select>
      <select name="period" defaultValue={filters.period} aria-label="Fecha" className={field}>
        {Object.entries(PERIODS).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select name="src" defaultValue={filters.src} aria-label="Fuente" className={field}>
        <option value="">Todas las fuentes</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        name="cve"
        defaultValue={filters.cve}
        placeholder="CVE-2026-…"
        aria-label="CVE"
        className={`${field} w-36 font-mono`}
      />
      <select name="estado" defaultValue={filters.estado} aria-label="Estado" className={field}>
        <option value="">Todo</option>
        <option value="unread">No leídos</option>
        <option value="fav">Favoritos</option>
      </select>
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Filtrar
      </button>
      <Link href="/" className="px-1 py-1.5 text-sm text-zinc-500 hover:underline">
        Limpiar
      </Link>
    </form>
  )
}
