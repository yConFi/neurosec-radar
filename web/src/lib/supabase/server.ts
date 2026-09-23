import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import type { Database } from "@/lib/database.types"

// Official pattern: https://supabase.com/docs/guides/auth/server-side/creating-a-client
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component: the proxy refreshes the session instead.
          }
        },
      },
    },
  )
}

/**
 * Supabase client for a verified user, or redirect to /login.
 * getClaims() validates the JWT signature (never trust getSession() on the server).
 * The real authorisation is RLS: a valid but non-owner user still reads nothing.
 */
export async function requireUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect("/login")
  return { supabase, userId: data.claims.sub as string, email: data.claims.email as string | undefined }
}
