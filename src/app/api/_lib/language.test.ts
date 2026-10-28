import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";

// The guess picks the starting language of the reply (English, French, German, Spanish, Italian).
// Every message below is invented; they are the kind of thing a customer writes about a parcel.
describe("detectLanguage", () => {
  it("keeps the old behaviour for English and French", () => {
    expect(detectLanguage("Hi, my vase arrived broken this morning.")).toBe("en");
    expect(detectLanguage("Bonjour, mon colis est arrivé ouvert, il manque un article.")).toBe("fr");
  });

  it("recognises German", () => {
    expect(detectLanguage("Guten Tag, meine Karaffe ist heute Morgen kaputt angekommen. Bestellung #1011, Foto im Anhang.")).toBe("de");
    expect(detectLanguage("Hallo, das Paket war schon geöffnet und es fehlt ein Artikel.")).toBe("de");
    // Only the letters point to German here.
    expect(detectLanguage("Größe zerbrochen")).toBe("de");
  });

  it("recognises Spanish", () => {
    expect(detectLanguage("Hola, mi jarrón llegó roto esta mañana. Adjunto una foto del pedido.")).toBe("es");
    expect(detectLanguage("Buenos días, el paquete estaba abierto y falta un artículo.")).toBe("es");
  });

  it("recognises Italian", () => {
    expect(detectLanguage("Buongiorno, il mio vaso è arrivato rotto stamattina. Allego una foto dell'ordine.")).toBe("it");
    expect(detectLanguage("Ciao, il pacco era aperto e manca un articolo.")).toBe("it");
  });

  it("is not fooled by the accents the languages share", () => {
    // é and è were always read as French; a Spanish or Italian message has more words than that.
    expect(detectLanguage("Hola, el paquete llegó roto y también falta la caja")).toBe("es");
    expect(detectLanguage("Il vaso è rotto, grazie")).toBe("it");
  });

  it("answers English when nothing is recognised, or when English has as many hits", () => {
    expect(detectLanguage("???")).toBe("en");
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage("Order 1042, con")).toBe("en");
    expect(detectLanguage("Hello, danke")).toBe("en");
  });

  it("gives a tie between two non-English languages to the first (French, then German, Spanish, Italian)", () => {
    // One word of each, and neither shared: the first of the order wins.
    expect(detectLanguage("hola ciao")).toBe("es");
    expect(detectLanguage("ciao hallo")).toBe("de");
  });

  it("does not let a word that two languages share decide, nor break a tie between them", () => {
    // "con" is on both the Spanish and the Italian list: half a hit each, which decides nothing alone.
    expect(detectLanguage("con")).toBe("en");
    // Shared words count for both, so the one distinctive word wins whatever the order of the languages.
    expect(detectLanguage("una con rotto")).toBe("it");
    expect(detectLanguage("una con roto")).toBe("es");
  });

  it("finds a short Italian message with no accented letter, which used to go to Spanish on a tie", () => {
    expect(detectLanguage("Buongiorno, la lampada ha una crepa")).toBe("it");
    expect(detectLanguage("Il vaso ha una crepa e non lo voglio")).toBe("it");
    expect(detectLanguage("Salve, ho ricevuto la lampada del mio ordine con una crepa nel vetro")).toBe("it");
    // And the Spanish and French ones around it are not pulled the other way.
    expect(detectLanguage("Hola, la lámpara tiene una grieta")).toBe("es");
    expect(detectLanguage("La lampe a une fissure")).toBe("fr");
  });

  it("does not turn a reply language into the language of a quoted order number or e-mail", () => {
    expect(detectLanguage("My parcel #12345 from jonas.weber@example.org arrived broken")).toBe("en");
  });
});
