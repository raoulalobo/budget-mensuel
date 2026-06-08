import { useEffect, useState } from 'react'

/**
 * Gestion du thème clair/sombre.
 *
 * Le thème sombre est piloté par la classe `dark` sur `<html>` : le CSS
 * (src/styles.css) définit déjà toutes les variables pour `.dark`. On persiste
 * le choix dans `localStorage`, avec repli sur la préférence système.
 */
const KEY = 'theme'

/** Détermine le thème initial : choix sauvegardé, sinon préférence système. */
export function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false
  const saved = localStorage.getItem(KEY)
  if (saved === 'dark') return true
  if (saved === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** Applique (ou retire) la classe `dark` sur la racine du document. */
export function applyDark(dark: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * Hook du bouton de bascule : expose l'état `dark` et un `toggle()` qui applique
 * la classe et persiste le choix.
 */
export function useDarkMode() {
  const [dark, setDark] = useState(false)

  // Applique le thème initial au montage (côté client).
  useEffect(() => {
    const d = getInitialDark()
    setDark(d)
    applyDark(d)
  }, [])

  function toggle() {
    setDark((prev) => {
      const next = !prev
      applyDark(next)
      try {
        localStorage.setItem(KEY, next ? 'dark' : 'light')
      } catch {
        /* localStorage indisponible : on ignore */
      }
      return next
    })
  }

  return { dark, toggle }
}
