"use client"

import type Anthropic from "@anthropic-ai/sdk"
import { useEffect, useRef, useState, useTransition } from "react"

import { clearChat } from "@/app/actions"
import { CHAT_MODEL, HISTORY_MESSAGES, MAX_ANSWER_TOKENS } from "@/lib/chat-config"

type Message = { role: "user" | "assistant"; content: string }

// The model sometimes uses Markdown bold despite the prompt. Render **text** as <strong>
// through React (escaped text nodes, never HTML); everything else stays literal.
function WithBold({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}
    </>
  )
}

const SUGGESTIONS = ["¿Me afecta y qué debería hacer?", "Explícamelo en términos técnicos", "¿Qué contexto hay detrás?"]

// ---------------------------------------------------------------------------
// Visitor's own Anthropic API key (BYOK). It never reaches this app's server or database:
// it lives in the visitor's browser (sessionStorage, or localStorage if they tick "remember")
// and is sent only to api.anthropic.com. Storage can be unavailable (private mode): every
// access is wrapped and the chat still works for the current page.
// ---------------------------------------------------------------------------
const KEY_NAME = "neurosec-radar:anthropic-key"

function readKey(): { key: string; remembered: boolean } | null {
  try {
    const remembered = localStorage.getItem(KEY_NAME)
    if (remembered) return { key: remembered, remembered: true }
    const session = sessionStorage.getItem(KEY_NAME)
    return session ? { key: session, remembered: false } : null
  } catch {
    return null
  }
}

function storeKey(key: string, remember: boolean) {
  try {
    ;(remember ? localStorage : sessionStorage).setItem(KEY_NAME, key)
  } catch {
    // storage blocked: the key stays in memory for this page only
  }
}

function forgetKey() {
  try {
    localStorage.removeItem(KEY_NAME)
    sessionStorage.removeItem(KEY_NAME)
  } catch {}
}

/** Streams an answer from the Anthropic API directly from the browser with the visitor's key. */
async function askAnthropic(key: string, system: string, history: Message[], question: string, onText: (t: string) => void) {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk") // loaded only when used
  // dangerouslyAllowBrowser: the SDK's guard against shipping *the app's* key to browsers.
  // Here the key is the visitor's own, typed in their browser; nothing to leak from us.
  const client = new AnthropicClient({ apiKey: key, dangerouslyAllowBrowser: true })
  const recent = history.slice(-HISTORY_MESSAGES)
  while (recent[0]?.role === "assistant") recent.shift() // the API needs a user turn first
  try {
    const stream = client.messages.stream({
      model: CHAT_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      system,
      messages: [...recent, { role: "user", content: question }],
    })
    let answer = ""
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        answer += event.delta.text
        onText(answer)
      }
    }
    const final = await stream.finalMessage()
    if (final.stop_reason === "max_tokens") onText(`${answer}\n\n[Respuesta cortada por longitud.]`)
    if (final.stop_reason === "refusal" || !answer.trim()) onText(`${answer}\n\n[El modelo no ha respondido a esta pregunta.]`.trim())
  } catch (err) {
    throw new Error(describeApiError(err, AnthropicClient))
  }
}

function describeApiError(err: unknown, SDK: typeof Anthropic): string {
  if (err instanceof SDK.AuthenticationError) return "Anthropic no acepta esa API key. Revísala o crea otra."
  if (err instanceof SDK.PermissionDeniedError) return "Tu API key no tiene permiso para usar este modelo."
  if (err instanceof SDK.RateLimitError) return "Tu cuenta de Anthropic ha llegado a su límite de uso. Prueba en un rato."
  if (err instanceof SDK.APIError && err.status === 400)
    return "Anthropic ha rechazado la petición. Revisa el saldo y la configuración de tu cuenta."
  if (err instanceof SDK.APIConnectionError) return "No se ha podido conectar con Anthropic."
  return "No se ha podido completar la respuesta. Inténtalo de nuevo."
}

// ---------------------------------------------------------------------------

/**
 * Chat about one article. Owner: via /api/chat (app key, history saved in Supabase).
 * Visitor (`byok`): straight from the browser to Anthropic with their own key; the
 * conversation lives only in this page. Answers are shown as plain text, never as HTML:
 * the model's output is influenced by untrusted article text.
 */
export function ArticleChat({
  articleId,
  initial,
  maxChars,
  byok,
}: {
  articleId: number
  initial: Message[]
  maxChars: number
  byok?: { system: string }
}) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [clearing, startClearing] = useTransition()
  const bottom = useRef<HTMLDivElement>(null)

  // BYOK state (visitor only)
  const [apiKey, setApiKey] = useState<{ key: string; remembered: boolean } | null>(null)
  const [keyInput, setKeyInput] = useState("")
  const [remember, setRemember] = useState(false)
  // Browser storage is only readable after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => (byok ? setApiKey(readKey()) : undefined), [byok])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || streaming) return
    if (byok && !apiKey) {
      setError("Primero introduce tu API key de Anthropic.")
      return
    }
    setError(null)
    setInput("")
    setStreaming(true)
    const history = messages
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }])
    const setAnswer = (content: string) => {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content }])
      bottom.current?.scrollIntoView({ block: "nearest" })
    }

    try {
      if (byok && apiKey) {
        await askAnthropic(apiKey.key, byok.system, history, text, setAnswer)
        return
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId, message: text }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? `Error ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let answer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        answer += decoder.decode(value, { stream: true })
        setAnswer(answer)
      }
    } catch (err) {
      setMessages((m) => m.slice(0, -2))
      setInput(text)
      setError(err instanceof Error ? err.message : "No se ha podido enviar la pregunta.")
    } finally {
      setStreaming(false)
    }
  }

  function clear() {
    if (byok) {
      setMessages([])
      setError(null)
      return
    }
    const form = new FormData()
    form.set("id", String(articleId))
    startClearing(async () => {
      await clearChat(form)
      setMessages([])
      setError(null)
    })
  }

  function saveKey(e: React.FormEvent) {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) return
    storeKey(key, remember)
    setApiKey({ key, remembered: remember })
    setKeyInput("")
    setError(null)
  }

  function dropKey() {
    forgetKey()
    setApiKey(null)
  }

  const needsKey = Boolean(byok && !apiKey)

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500">Pregunta a la IA</h2>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clear}
            disabled={clearing || streaming}
            className="ml-auto text-xs text-zinc-500 hover:underline disabled:opacity-50"
          >
            {clearing ? "Borrando…" : "Borrar conversación"}
          </button>
        )}
      </div>

      {needsKey && (
        <form
          onSubmit={saveKey}
          className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
            Para preguntar a Claude sobre esta noticia, usa tu propia API key de Anthropic. Tu navegador la envía{" "}
            <strong>directamente a Anthropic</strong>: nunca pasa por el servidor de esta web ni se guarda en su base de
            datos. Anthropic te cobra el uso (Claude Haiku 4.5, en torno a 0,003 $ por pregunta).
          </p>
          <p className="text-xs text-zinc-500">
            Consíguela en{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline dark:text-sky-400"
            >
              console.anthropic.com
            </a>
            . Recomendado: una key solo para esto, con límite de gasto.
          </p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-ant-…"
            aria-label="Tu API key de Anthropic"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-300 bg-white p-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Recordar en este navegador (si no, se olvida al cerrar la pestaña)
            </label>
            <button
              type="submit"
              disabled={!keyInput.trim()}
              className="ml-auto rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Usar mi key
            </button>
          </div>
        </form>
      )}

      {messages.length > 0 && (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <p
                className={
                  m.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
                }
              >
                {m.content ? <WithBold text={m.content} /> : streaming && i === messages.length - 1 ? "…" : ""}
              </p>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}

      {!needsKey && messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              disabled={streaming}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {!needsKey && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="space-y-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                ask(input)
              }
            }}
            rows={2}
            maxLength={maxChars}
            placeholder="Pregunta sobre esta noticia… (Enter envía, Mayús+Enter salto de línea)"
            aria-label="Pregunta a la IA"
            className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {streaming ? "Respondiendo…" : "Preguntar"}
            </button>
            <span className="text-xs text-zinc-500">Claude Haiku 4.5 · responde con lo que dice la noticia</span>
            {byok && apiKey && (
              <span className="ml-auto text-xs text-zinc-500">
                Tu key: {apiKey.remembered ? "recordada en este navegador" : "solo en esta pestaña"} ·{" "}
                <button type="button" onClick={dropKey} className="hover:underline">
                  Olvidar key
                </button>
              </span>
            )}
          </div>
          {byok && <p className="text-xs text-zinc-500">La conversación no se guarda: se pierde al recargar la página.</p>}
        </form>
      )}
    </section>
  )
}
