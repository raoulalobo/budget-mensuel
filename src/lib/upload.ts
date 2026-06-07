import { downscaleImage } from './image'

/**
 * Helpers d'upload d'image vers le file storage Convex.
 *
 * Flux Convex standard : une mutation (`generateUploadUrl`) renvoie une URL
 * signée ; on y POST le fichier ; la réponse contient le `storageId` à rattacher
 * à une ligne de budget. L'image est compressée avant envoi (taille/coût).
 */

/** POST un blob sur une upload URL Convex et renvoie le storageId. */
async function postBlob(
  blob: Blob,
  mime: string,
  getUploadUrl: () => Promise<string>,
): Promise<string> {
  const url = await getUploadUrl()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': mime },
    body: blob,
  })
  if (!res.ok) {
    throw new Error("Échec de l'envoi de l'image au stockage")
  }
  const { storageId } = await res.json()
  return storageId as string
}

/**
 * Compresse un `File` (caméra/galerie) puis l'upload. Renvoie le storageId.
 * Utilisé pour l'attache manuelle d'une photo depuis le détail d'une ligne.
 */
export async function uploadImageFile(
  file: File,
  getUploadUrl: () => Promise<string>,
): Promise<string> {
  const { dataUrl, mime } = await downscaleImage(file)
  const blob = await (await fetch(dataUrl)).blob()
  return postBlob(blob, mime, getUploadUrl)
}

/**
 * Upload une image déjà compressée (fournie sous forme de dataURL). Renvoie le
 * storageId. Utilisé par l'import groupé, où l'image est déjà préparée.
 */
export async function uploadImageDataUrl(
  dataUrl: string,
  mime: string,
  getUploadUrl: () => Promise<string>,
): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  return postBlob(blob, mime, getUploadUrl)
}
