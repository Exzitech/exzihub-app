/**
 * Photos (Carnet, Sticky Notes) : reduites avant l'envoi. La connexion de la maison plafonne a ~450 Ko/s en envoi,
 * et le dossier partage sert de stockage durable pour les deux foyers ; un JPEG de 1600 px
 * (~200-400 Ko) reste net en plein ecran sur un telephone comme sur un PC.
 *
 * `toDataURL` plutot que `toBlob` : sur Android WebView, toBlob prend plusieurs secondes
 * par image (constate sur l'impression des routines), toDataURL est immediat. Le base64
 * obtenu est justement ce qu'attend sync.ecrireOctets.
 */
const COTE_MAX = 1600;
const QUALITE = 0.75;

/** Charge un fichier image ; erreur explicite si le format n'est pas lisible par le navigateur. */
function charger(fichier: File): Promise<HTMLImageElement> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resoudre(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      rejeter(new Error(`${fichier.name} : image illisible`));
    };
    image.src = url;
  });
}

/** Le JPEG reduit, en base64 (sans l'en-tete `data:`), pret pour sync.ecrireOctets. */
export async function preparer(fichier: File): Promise<string> {
  const image = await charger(fichier);
  const echelle = Math.min(1, COTE_MAX / Math.max(image.naturalWidth, image.naturalHeight));
  const toile = document.createElement("canvas");
  toile.width = Math.round(image.naturalWidth * echelle);
  toile.height = Math.round(image.naturalHeight * echelle);
  const ctx = toile.getContext("2d");
  if (!ctx) throw new Error("Le redimensionnement des photos n'est pas disponible sur cet appareil");
  ctx.drawImage(image, 0, 0, toile.width, toile.height);
  const url = toile.toDataURL("image/jpeg", QUALITE);
  return url.slice(url.indexOf(",") + 1);
}

export const enDataUrl = (base64: string) => `data:image/jpeg;base64,${base64}`;
