import Anthropic from "@anthropic-ai/sdk"

import {
  CHAT_MODEL,
  MAX_ANSWER_TOKENS,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS_PER_ARTICLE,
  MAX_QUESTIONS_PER_DAY,
  getChatContext,
  getChatHistory,
  getQuestionCounts,
} from "@/lib/chat"
import { createClient } from "@/lib/supabase/server"

// Haiku answers in a few seconds; this is only a ceiling for the streamed response.
export const maxDuration = 60

const fail = (status: number, error: string) => Response.json({ error }, { status })

function sameOrigin(request: Request): boolean {
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    return Boolean(host) && new URL(request.headers.get("origin") ?? "").host === host
  } catch {
    return false // missing or opaque ("null") Origin
  }
}

/**
 * POST /api/chat  {articleId, message}  ->  text/plain stream with the answer.
 *
 * Authorisation is the same as everywhere else: a verified session + RLS. The article is read
 * with the user's client, so a non-owner gets 404, and the conversation is written with it too.
 * ANTHROPIC_API_KEY is a server-only env var (never NEXT_PUBLIC_).
 */
export async function POST(request: Request) {
  // Same-origin JSON only: a cross-site form can't send application/json without CORS.
  if (!sameOrigin(request)) return fail(403, "Origen no permitido.")
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail(415, "Se espera JSON.")

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims) return fail(401, "Sesión caducada. Vuelve a iniciar sesión.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "JSON no válido.")
  }
  const { articleId, message } = (body ?? {}) as { articleId?: unknown; message?: unknown }
  const id = Number(articleId)
  const question = typeof message === "string" ? message.trim() : ""
  if (!Number.isSafeInteger(id) || id <= 0) return fail(400, "Noticia no válida.")
  if (!question) return fail(400, "Escribe una pregunta.")
  if (question.length > MAX_QUESTION_CHARS) return fail(400, `Máximo ${MAX_QUESTION_CHARS} caracteres.`)

  if (!process.env.ANTHROPIC_API_KEY) return fail(503, "Falta configurar ANTHROPIC_API_KEY en Vercel.")

  const context = await getChatContext(supabase, id)
  if (!context) return fail(404, "Noticia no encontrada.")

  const counts = await getQuestionCounts(supabase, id)
  if (counts.perArticle >= MAX_QUESTIONS_PER_ARTICLE)
    return fail(429, `Límite de ${MAX_QUESTIONS_PER_ARTICLE} preguntas en esta noticia. Borra la conversación para empezar otra.`)
  if (counts.perDay >= MAX_QUESTIONS_PER_DAY)
    return fail(429, `Límite de ${MAX_QUESTIONS_PER_DAY} preguntas en 24 h alcanzado.`)

  const history = await getChatHistory(supabase, id)
  // The API needs the first message to be from the user: drop a leading assistant turn
  // (possible when the history window cuts a conversation in half).
  while (history[0]?.role === "assistant") history.shift()

  const client = new Anthropic() // reads ANTHROPIC_API_KEY
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: MAX_ANSWER_TOKENS,
    system: context.system,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ],
  })

  const encoder = new TextEncoder()
  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        const final = await stream.finalMessage()
        let answer = final.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim()
        if (final.stop_reason === "max_tokens") {
          const note = "\n\n[Respuesta cortada por longitud.]"
          controller.enqueue(encoder.encode(note))
          answer += note
        }
        if (final.stop_reason === "refusal" || !answer) {
          const note = "\n\n[El modelo no ha respondido a esta pregunta.]"
          controller.enqueue(encoder.encode(note))
          answer = (answer + note).trim()
        }
        // Saved only once the answer is complete: a failed call leaves no half turn behind.
        const { error } = await supabase.from("chat_messages").insert([
          { article_id: id, role: "user", content: question },
          {
            article_id: id,
            role: "assistant",
            content: answer.slice(0, 20_000),
            model: final.model,
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
          },
        ])
        if (error) throw error
      } catch (err) {
        console.error("chat failed", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err)
        controller.enqueue(encoder.encode("\n\n[Error: no se ha podido completar la respuesta. Inténtalo de nuevo.]"))
      } finally {
        controller.close()
      }
    },
    cancel() {
      stream.abort()
    },
  })

  return new Response(output, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  })
}
