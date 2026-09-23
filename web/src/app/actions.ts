"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { createClient, requireUser } from "@/lib/supabase/server"

// Server Actions are public HTTP endpoints: validate every input and rely on
// requireUser() + RLS (article_states policy) for authorisation.

function articleId(formData: FormData): number {
  const id = Number(formData.get("id"))
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid article id")
  return id
}

async function upsertState(id: number, patch: { read_at?: string | null; favorite?: boolean; note?: string | null }) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("article_states")
    .upsert({ article_id: id, ...patch }, { onConflict: "user_id,article_id" })
  if (error) throw new Error(error.message)
  revalidatePath("/")
  revalidatePath(`/article/${id}`)
}

export async function setRead(formData: FormData) {
  const read = formData.get("read") === "1"
  await upsertState(articleId(formData), { read_at: read ? new Date().toISOString() : null })
}

export async function setFavorite(formData: FormData) {
  await upsertState(articleId(formData), { favorite: formData.get("favorite") === "1" })
}

export async function saveNote(formData: FormData) {
  const note = String(formData.get("note") ?? "").slice(0, 10_000).trim()
  await upsertState(articleId(formData), { note: note || null })
}

export async function markAllBannerRead(formData: FormData) {
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .slice(0, 50)
  if (!ids.length) return
  const { supabase } = await requireUser()
  const now = new Date().toISOString()
  const { error } = await supabase
    .from("article_states")
    .upsert(ids.map((article_id) => ({ article_id, read_at: now })), { onConflict: "user_id,article_id" })
  if (error) throw new Error(error.message)
  revalidatePath("/")
}

export type LoginState = { error: string } | null

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "Introduce email y contraseña." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  // Same message for every failure: don't reveal whether the account exists.
  if (error) return { error: "No se ha podido iniciar sesión. Revisa los datos." }
  redirect("/")
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
