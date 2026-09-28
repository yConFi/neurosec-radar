import Link from "next/link"

import { signOut } from "@/app/actions"

export function Header({ email }: { email?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          <span className="text-red-600">●</span> NeuroSec Radar
        </Link>
        <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Inicio
          </Link>
          <Link href="/?estado=unread" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            No leídos
          </Link>
          <Link href="/?estado=fav" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Favoritos
          </Link>
          <Link href="/semanal" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Semanal
          </Link>
        </nav>
        <form action={signOut} className="ml-auto flex items-center gap-3">
          {email && <span className="hidden text-xs text-zinc-500 sm:inline">{email}</span>}
          <button type="submit" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            Salir
          </button>
        </form>
      </div>
    </header>
  )
}
