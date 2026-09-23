"use client"

import { useActionState } from "react"

import { signIn, type LoginState } from "@/app/actions"

const field =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null)

  return (
    <form action={action} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <label className="block space-y-1 text-sm">
        <span>Email</span>
        <input type="email" name="email" autoComplete="email" required className={field} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Contraseña</span>
        <input type="password" name="password" autoComplete="current-password" required className={field} />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  )
}
