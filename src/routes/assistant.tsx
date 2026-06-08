import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import Markdown from '../components/Markdown'

/**
 * Route /assistant : chat budgétaire. L'utilisateur pose des questions en langage
 * naturel sur ses données ; les réponses viennent de DeepSeek (action
 * `assistant.ask`). L'historique de la conversation est conservé côté composant
 * et renvoyé à chaque message (l'action est stateless).
 */
export const Route = createFileRoute('/assistant')({
  component: AssistantPage,
})

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

// Questions proposées quand la conversation est vide.
const SUGGESTIONS = [
  'Quel est mon plus gros poste de dépense ?',
  'Où puis-je économiser ?',
  'Compare mes revenus et mes dépenses ce mois-ci.',
  'Combien ai-je sur mes placements ?',
]

function AssistantPage() {
  const ask = useAction(api.assistant.ask)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function send(text: string) {
    const content = text.trim()
    if (!content || loading) return
    setInput('')
    const next: Msg[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setLoading(true)
    // Laisse le temps au DOM puis scrolle en bas.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
    )
    try {
      const res = await ask({ messages: next })
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.answer ?? `⚠️ ${res.error ?? 'Erreur inconnue.'}`,
        },
      ])
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `⚠️ ${e instanceof Error ? e.message : 'Erreur.'}`,
        },
      ])
    } finally {
      setLoading(false)
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7c3aed1a] text-[#7c3aed]">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">Assistant budgétaire</h1>
          <p className="text-sm text-muted-foreground">
            Pose une question sur tes finances — réponses basées sur tes données.
          </p>
        </div>
      </div>

      <div className="app-card flex h-[65vh] flex-col overflow-hidden">
        {/* Fil de conversation */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Sparkles className="h-8 w-8 text-[#7c3aed]" />
              <p className="text-sm text-muted-foreground">
                Pose-moi une question, ou choisis une suggestion :
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="app-badge cursor-pointer bg-muted text-foreground hover:bg-accent"
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-2">
                  <Markdown text={m.content} />
                </div>
              </div>
            ),
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Je réfléchis…
              </div>
            </div>
          )}
        </div>

        {/* Saisie */}
        <form
          className="flex items-center gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <input
            className="app-input flex-1"
            placeholder="Pose ta question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="app-btn-primary"
            disabled={loading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
