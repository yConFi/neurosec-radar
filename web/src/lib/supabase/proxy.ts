import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import type { Database } from "@/lib/database.types"

// Official pattern: refreshes the auth token on every request and keeps
// browser + server cookies in sync. Pages are public (read-only demo): they call
// getViewer() and RLS decides what each role reads. Only the API needs a session.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))
        },
      },
    },
  )

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims()
  // fetch() would follow a redirect and get a page as a 200: answer API calls with 401.
  if (!data?.claims && request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sesión caducada. Vuelve a iniciar sesión." }, { status: 401 })
  }

  return response
}
