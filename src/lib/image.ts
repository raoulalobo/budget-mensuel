/**
 * Utilitaire de redimensionnement/compression d'image côté navigateur.
 *
 * Pourquoi : une photo de smartphone brute pèse 4–12 Mo (et +33 % en base64),
 * ce qui dépasse la limite d'arguments d'une fonction Convex et coûte cher en
 * tokens vision. On réduit donc l'image (grand côté ≤ `maxEdge`) et on la
 * ré-encode en JPEG avant de l'envoyer à l'analyse.
 *
 * Bonus : le ré-encodage en JPEG via <canvas> gère aussi les formats exotiques
 * (HEIC d'iPhone) tant que le navigateur sait les décoder pour l'affichage.
 */

/** Résultat de la compression : dataURL (aperçu), base64 pur, type MIME. */
export interface DownscaledImage {
  dataUrl: string // "data:image/jpeg;base64,...." — pour <img src>
  base64: string // données seules, sans préfixe — pour l'envoi à l'action
  mime: string // toujours "image/jpeg" ici
}

/** Charge un fichier image dans un élément <img> décodé. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Image illisible"))
    img.src = src
  })
}

/**
 * Redimensionne et compresse un fichier image.
 *
 * @param file     fichier issu d'un <input type="file">
 * @param maxEdge  taille max (px) du plus grand côté (défaut 1600)
 * @param quality  qualité JPEG entre 0 et 1 (défaut 0.8)
 */
export async function downscaleImage(
  file: File,
  maxEdge = 1600,
  quality = 0.8,
): Promise<DownscaledImage> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    // Facteur d'échelle : ne jamais agrandir (scale ≤ 1).
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas non supporté')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // Toujours ré-encoder en JPEG (type MIME garanti, taille maîtrisée).
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const base64 = dataUrl.split(',')[1] ?? ''
    return { dataUrl, base64, mime: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
