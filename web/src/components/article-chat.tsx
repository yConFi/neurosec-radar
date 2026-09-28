"use client"

import { useRef, useState, useTransition } from "react"

import { clearChat } from "@/app/actions"

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

// Answers are shown as plain text (whitespace-pre-wrap), never as HTML: the model's output is
// influenced by untrusted article text.
export function ArticleChat({ articleId, initial, maxChars }: { articleId: number; initial: Message[]; maxChars: number }) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [clearing, startClearing] = useTransition()
  const bottom = useRef<HTMLDivElement>(null)

  async function ask(question: string) {
    const text = question.trim()
    if (!text || streaming) return
    setError(null)
    setInput("")
    setStreaming(true)
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }])
    const setAnswer = (content: string) =>
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content }])

    try {
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
        bottom.current?.scrollIntoView({ block: "nearest" })
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
    const form = new FormData()
    form.set("id", String(articleId))
    startClearing(async () => {
      await clearChat(form)
      setMessages([])
      setError(null)
    })
  }

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

      {messages.length === 0 && (
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
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {streaming ? "Respondiendo…" : "Preguntar"}
          </button>
          <span className="text-xs text-zinc-500">Claude Haiku 4.5 · responde con lo que dice la noticia</span>
        </div>
      </form>
    </section>
  )
}
