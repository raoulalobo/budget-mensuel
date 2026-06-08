import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { X, Sparkles, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../convex/_generated/api'

/**
 * Modale « Récap IA du mois » : demande à Claude une synthèse + des conseils à
 * partir des chiffres réels du mois, et les affiche. Génère automatiquement à
 * l'ouverture ; bouton « Régénérer ».
 */
export default function MonthRecapDialog({
  year,
  month,
  monthLabel,
  onClose,
}: {
  year: number
  month: number
  monthLabel: string
  onClose: () => void
}) {
  const recap = useAction(api.recap.monthlyRecap)
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setText(null)
    try {
      const res = await recap({ year, month })
      setText(res.text)
      setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la génération.')
    } finally {
      setLoading(false)
    }
  }

  // Génère une fois à l'ouverture.
  useEffect(() => {
    void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="app-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-[#7c3aed]" /> Récap IA — {monthLabel}
          </h2>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analyse de ton mois…
            </div>
          ) : error ? (
            <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {error}
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-sm leading-relaxed">
              {renderMarkdown(text ?? '')}
            </div>
          )}
        </div>

        {/* Pied */}
        <div className="flex justify-between gap-2 border-t border-border px-5 py-3">
          <button className="app-btn-ghost" onClick={() => void generate()} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Régénérer
          </button>
          <button className="app-btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}

/** Rendu léger d'un Markdown simple (titres ##, puces -, gras **). */
function renderMarkdown(md: string) {
  return md.split('\n').map((line, i) => {
    const trimmed = line.trim()
    if (trimmed === '') return <div key={i} className="h-2" />
    if (trimmed.startsWith('## ')) {
      return (
        <h3 key={i} className="mt-2 font-semibold">
          {inline(trimmed.slice(3))}
        </h3>
      )
    }
    if (trimmed.startsWith('# ')) {
      return (
        <h2 key={i} className="mt-2 text-base font-bold">
          {inline(trimmed.slice(2))}
        </h2>
      )
    }
    if (/^[-*]\s/.test(trimmed)) {
      return (
        <div key={i} className="flex gap-2">
          <span className="text-[#7c3aed]">•</span>
          <span>{inline(trimmed.replace(/^[-*]\s/, ''))}</span>
        </div>
      )
    }
    return <p key={i}>{inline(trimmed)}</p>
  })
}

/** Convertit le **gras** Markdown en <strong>. */
function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}
