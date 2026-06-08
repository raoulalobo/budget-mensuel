/**
 * Rendu léger d'un Markdown simple (titres #/##, puces -/*, gras **texte**).
 * Suffisant pour les réponses IA (récap, assistant) sans dépendance externe.
 */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm leading-relaxed">
      {text.split('\n').map((line, i) => {
        const trimmed = line.trim()
        if (trimmed === '') return <div key={i} className="h-1.5" />
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={i} className="mt-1 font-semibold">
              {inline(trimmed.slice(3))}
            </h3>
          )
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={i} className="mt-1 text-base font-bold">
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
      })}
    </div>
  )
}

/** Convertit le **gras** Markdown en <strong>. */
function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}
