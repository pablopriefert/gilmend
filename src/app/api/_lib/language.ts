// Cheap language guess for the customer's message, used to pick the language of the reply
// when the form does not say. Only English and French matter for the demo; anything we
// cannot tell defaults to English. The agent may refine it, this is just the starting point.

const FRENCH_WORDS = new Set([
  "bonjour", "bonsoir", "merci", "mon", "ma", "mes", "est", "sont", "je", "j", "il", "elle",
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "pas", "pour", "avec", "sans",
  "colis", "commande", "reçu", "recu", "arrivé", "arrive", "cassé", "casse", "brisé", "abîmé",
  "abime", "ouvert", "manque", "manquant", "article", "livraison", "livré", "livre", "photo",
  "photos", "ci-joint", "vase", "tasse", "tasses", "boîte", "boite", "cordialement", "svp",
]);
const ENGLISH_WORDS = new Set([
  "hello", "hi", "thanks", "thank", "my", "the", "is", "are", "was", "were", "it", "and",
  "not", "for", "with", "without", "parcel", "package", "order", "received", "arrived",
  "broken", "damaged", "open", "opened", "missing", "item", "delivery", "delivered", "photo",
  "photos", "attached", "please", "box", "cracked", "crushed", "a", "i", "this", "that",
]);

export function detectLanguage(message: string): "en" | "fr" {
  const lower = message.toLowerCase();
  let fr = /[àâçéèêëîïôûùüÿœ]/.test(lower) ? 2 : 0;
  let en = 0;
  for (const word of lower.split(/[^a-zà-ÿœ'-]+/)) {
    if (FRENCH_WORDS.has(word)) fr += 1;
    if (ENGLISH_WORDS.has(word)) en += 1;
  }
  return fr > en ? "fr" : "en";
}
