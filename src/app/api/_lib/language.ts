// Cheap language guess for the customer's message, used to pick the language of the reply
// when the form does not say. English, French, German, Spanish and Italian (the last three since
// 28 Oct 2026, src/lib/languages.ts); anything we cannot tell defaults to English. The agent may
// refine it (it follows the language of the message among these five), this is just the starting point.
//
// Method: every language has a short list of frequent words that the others do not share, plus a
// few letters only it uses (ä ö ü ß for German, ñ ¿ ¡ for Spanish...). The language with the most
// hits wins, and it must beat English. A tie between two non-English languages goes to the first
// of LANGUAGES, which keeps the old rule (French wins any tie it was part of). Letters that several
// languages share (é, è, à) score for no one; only words count for them.

import type { LanguageCode } from "../../../lib/languages";

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
const GERMAN_WORDS = new Set([
  "hallo", "guten", "tag", "danke", "vielen", "dank", "mein", "meine", "meinen", "meiner", "ist",
  "sind", "waren", "ich", "nicht", "und", "der", "die", "das", "ein", "eine", "einen", "mit",
  "ohne", "für", "fur", "paket", "bestellung", "angekommen", "kaputt", "zerbrochen", "zerbrochene",
  "beschädigt", "beschadigt", "beschaedigt", "geöffnet", "geoffnet", "fehlt", "fehlen", "artikel",
  "lieferung", "geliefert", "anbei", "bitte", "karton", "vase", "tasse", "tassen",
  "freundlichen", "grüßen", "grussen", "grüße", "gruße", "heute", "leider", "wurde", "haben",
  "sehr", "dem", "aber", "gebrochen", "riss", "ersatz", "erstattung", "bestellnummer", "schaden",
]);
const SPANISH_WORDS = new Set([
  "hola", "buenos", "días", "dias", "gracias", "mi", "mis", "es", "son", "está", "esta", "estaba",
  "llegó", "llego", "roto", "rota", "rotos", "rotas", "pedido", "paquete", "caja", "dañado",
  "danado", "dañada", "abierto", "falta", "faltan", "artículo", "articulo", "entrega", "entregado",
  "adjunto", "adjunta", "por", "favor", "para", "con", "sin", "el", "los", "las",
  "un", "una", "y", "no", "que", "ha", "he", "saludos", "cordialmente", "jarrón", "jarron", "taza",
  "tazas", "hoy", "pero", "muy", "reembolso", "envío", "envio",
]);
const ITALIAN_WORDS = new Set([
  "ciao", "buongiorno", "buonasera", "grazie", "mio", "mia", "miei", "mie", "è", "sono", "era",
  "arrivato", "arrivata", "rotto", "rotta", "rotti", "rotte", "ordine", "pacco", "scatola",
  "danneggiato", "danneggiata", "aperto", "manca", "mancano", "articolo", "consegna", "consegnato",
  "allegata", "allegato", "per", "favore", "con", "senza", "il", "lo", "gli", "un", "una",
  "e", "non", "che", "cordiali", "saluti", "vaso", "tazza", "tazze", "oggi", "ma", "molto",
  "rimborso", "spedizione",
  // The very frequent ones that were missing (28 Oct 2026): "la lampada ha una crepa" has no accent and
  // few listed words, and used to go to Spanish on a tie.
  "la", "le", "ha", "ho", "hanno", "di", "del", "della", "dello", "nel", "nella", "dei", "delle",
  "lampada", "crepa", "crepato", "scheggiato", "rovinato", "arrivata", "ricevuto", "salve",
]);

// A word listed for several non-English languages ("un", "una", "con", "la", "ha"...) says little about
// which one the message is in, and the first of LANGUAGES used to win the tie it created (Spanish for an
// Italian "la lampada ha una crepa", 28 Oct 2026). Such a word now counts 1 / (number of languages that
// list it) for each of them, so only a word that belongs to one language can break a tie. English is left
// out of this (it is the default the others must beat).
function weigh(lists: Set<string>[]): Map<string, number>[] {
  const seen = new Map<string, number>();
  for (const list of lists) for (const w of list) seen.set(w, (seen.get(w) ?? 0) + 1);
  return lists.map((list) => new Map([...list].map((w) => [w, 1 / (seen.get(w) ?? 1)])));
}
const [FRENCH_WEIGHTS, GERMAN_WEIGHTS, SPANISH_WEIGHTS, ITALIAN_WEIGHTS] = weigh([
  FRENCH_WORDS,
  GERMAN_WORDS,
  SPANISH_WORDS,
  ITALIAN_WORDS,
]);

// Letters that point to one language. The French set is the one the guess always used (é and è
// included: they were French before there was another language, and a Spanish or Italian message
// has more words than that to outscore them); ä ö ü ß are German, ñ ¿ ¡ and the acute á í ó ú Spanish.
const FRENCH_LETTERS = /[àâçéèêëîïôûùÿœ]/;
const GERMAN_LETTERS = /[äöüß]/;
const SPANISH_LETTERS = /[ñ¿¡áíóú]/;

type Guess = Exclude<LanguageCode, "en">;

// The order is the tie-break among non-English languages.
const LANGUAGES: { code: Guess; words: Map<string, number>; letters: RegExp | null; letterScore: number }[] = [
  { code: "fr", words: FRENCH_WEIGHTS, letters: FRENCH_LETTERS, letterScore: 2 },
  { code: "de", words: GERMAN_WEIGHTS, letters: GERMAN_LETTERS, letterScore: 2 },
  { code: "es", words: SPANISH_WEIGHTS, letters: SPANISH_LETTERS, letterScore: 2 },
  { code: "it", words: ITALIAN_WEIGHTS, letters: null, letterScore: 0 },
];

export function detectLanguage(message: string): LanguageCode {
  const lower = message.toLowerCase();
  const scores = new Map<Guess, number>(
    LANGUAGES.map((l) => [l.code, l.letters && l.letters.test(lower) ? l.letterScore : 0]),
  );
  let en = 0;
  for (const word of lower.split(/[^\p{L}'-]+/u)) {
    if (ENGLISH_WORDS.has(word)) en += 1;
    for (const l of LANGUAGES) {
      const weight = l.words.get(word);
      if (weight !== undefined) scores.set(l.code, (scores.get(l.code) ?? 0) + weight);
    }
  }
  let best: Guess | null = null;
  for (const l of LANGUAGES) {
    if (best === null || (scores.get(l.code) ?? 0) > (scores.get(best) ?? 0)) best = l.code;
  }
  // A lone shared word (0.5 at most) never decides the language.
  return best !== null && (scores.get(best) ?? 0) > en && (scores.get(best) ?? 0) >= 1 ? best : "en";
}
