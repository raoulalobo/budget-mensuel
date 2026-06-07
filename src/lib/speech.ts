import { useEffect, useRef, useState } from 'react'

/**
 * Hook de dictée vocale (speech-to-text) basé sur l'API Web Speech native du
 * navigateur (`SpeechRecognition` / `webkitSpeechRecognition`).
 *
 * - Aucune dépendance ni backend : la reconnaissance se fait dans le navigateur.
 * - Nécessite un contexte sécurisé (https ou localhost) et un navigateur
 *   compatible (Chrome/Edge). Sinon `supported` vaut `false` et l'UI masque le
 *   bouton micro.
 *
 * @param lang     langue de reconnaissance (défaut "fr-FR")
 * @param onResult appelé avec le texte transcrit (à AJOUTER au texte existant)
 */
export function useSpeechToText({
  lang = 'fr-FR',
  onResult,
}: {
  lang?: string
  onResult: (text: string) => void
}) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<any>(null)
  // onResult est gardé dans une ref pour que l'effet d'init reste stable.
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      return
    }
    setSupported(true)

    const rec = new SR()
    rec.lang = lang
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join(' ')
        .trim()
      if (transcript) onResultRef.current(transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec

    return () => {
      try {
        rec.abort()
      } catch {
        /* ignore */
      }
    }
  }, [lang])

  function start() {
    const rec = recognitionRef.current
    if (!rec) return
    try {
      rec.start()
      setListening(true)
    } catch {
      /* déjà démarré : on ignore */
    }
  }

  function stop() {
    const rec = recognitionRef.current
    if (!rec) return
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
    setListening(false)
  }

  return { supported, listening, start, stop }
}
