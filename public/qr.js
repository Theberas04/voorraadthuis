/*!
 * qr.js — maakt een QR-code, helemaal in de browser. Geen internet, geen externe dienst:
 * het adres van je eigen app verlaat je toestel niet.
 *
 * Waarom zelf en niet een bibliotheek: de app moet ook werken als hij geen internet heeft,
 * en een QR die niet klopt is erger dan geen QR. Daarom is dit bestand klein gehouden
 * (bytemodus, foutcorrectie M, versies 1 tot en met 10) en wordt het in de tests met een
 * onafhankelijke decoder (jsQR) nagelezen.
 *
 * Gebruik:  const qr = maakQr('https://voorbeeld.ics');
 *           qr.modules  -> rijen met 0 (licht) en 1 (donker)
 *           qr.maat, qr.versie, qr.masker
 */
(function (wortel) {
  'use strict';

  // ---- Rekenen in GF(256), nodig voor de foutcorrectie ---------------------------
  const EXP = new Array(512);
  const LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  })();

  function vermenigvuldig(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function generatorPolynoom(graad) {
    let polynoom = [1];
    for (let i = 0; i < graad; i += 1) {
      const volgend = new Array(polynoom.length + 1).fill(0);
      for (let j = 0; j < polynoom.length; j += 1) {
        volgend[j] ^= polynoom[j];
        volgend[j + 1] ^= vermenigvuldig(polynoom[j], EXP[i]);
      }
      polynoom = volgend;
    }
    return polynoom;
  }

  // De foutcorrectiebijtjes die bij een blok horen (rest van de deling).
  function foutcorrectie(data, aantal) {
    const generator = generatorPolynoom(aantal);
    const rest = data.concat(new Array(aantal).fill(0));
    for (let i = 0; i < data.length; i += 1) {
      const factor = rest[i];
      if (factor === 0) continue;
      for (let j = 0; j < generator.length; j += 1) {
        rest[i + j] ^= vermenigvuldig(generator[j], factor);
      }
    }
    return rest.slice(data.length);
  }

  // ---- Tabellen uit de QR-standaard (foutcorrectie M) ---------------------------
  // per versie: [correctiebijtjes per blok, blokken groep 1, databijtjes groep 1,
  // blokken groep 2, databijtjes groep 2]
  const BLOKKEN_M = {
    1: [10, 1, 16, 0, 0],
    2: [16, 1, 28, 0, 0],
    3: [26, 1, 44, 0, 0],
    4: [18, 2, 32, 0, 0],
    5: [24, 2, 43, 0, 0],
    6: [16, 4, 27, 0, 0],
    7: [18, 4, 31, 0, 0],
    8: [22, 2, 38, 2, 39],
    9: [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44],
  };

  const LIJNEN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  function databijtjes(versie) {
    const [ , g1, d1, g2, d2] = BLOKKEN_M[versie];
    return g1 * d1 + g2 * d2;
  }

  function kiesVersie(aantalBytes) {
    for (let versie = 1; versie <= 10; versie += 1) {
      const kop = versie < 10 ? 12 : 20; // modus (4) + telling (8 of 16)
      if (databijtjes(versie) * 8 - kop >= aantalBytes * 8) return versie;
    }
    return 0;
  }

  // ---- De gegevensstroom opbouwen ------------------------------------------------
  function bitStroom(bytes, versie) {
    const bits = [];
    const duw = (waarde, aantal) => {
      for (let i = aantal - 1; i >= 0; i -= 1) bits.push((waarde >> i) & 1);
    };
    duw(0b0100, 4);                       // bytemodus
    duw(bytes.length, versie < 10 ? 8 : 16);
    for (const byte of bytes) duw(byte, 8);

    const ruimte = databijtjes(versie) * 8;
    // Eindigen met nullen, daarna de vaste opvulbytes 11101100 en 00010001.
    for (let i = 0; i < 4 && bits.length < ruimte; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    let opvulling = 0;
    while (bits.length < ruimte) {
      const byte = opvulling % 2 === 0 ? 0b11101100 : 0b00010001;
      for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
      opvulling += 1;
    }
    const bytesUit = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      bytesUit.push(byte);
    }
    return bytesUit;
  }

  // De blokken van de standaard: eerst de blokken kort/lang verdelen, elk met eigen
  // foutcorrectie, daarna om en om door elkaar vlechten zoals voorgeschreven.
  function metFoutcorrectie(dataBytes, versie) {
    const [ecPerBlok, g1, d1, g2, d2] = BLOKKEN_M[versie];
    const blokken = [];
    let plek = 0;
    for (let i = 0; i < g1; i += 1) { blokken.push(dataBytes.slice(plek, plek + d1)); plek += d1; }
    for (let i = 0; i < g2; i += 1) { blokken.push(dataBytes.slice(plek, plek + d2)); plek += d2; }
    const correcties = blokken.map(blok => foutcorrectie(blok, ecPerBlok));

    const uit = [];
    const langste = Math.max(...blokken.map(b => b.length));
    for (let i = 0; i < langste; i += 1) {
      for (const blok of blokken) if (i < blok.length) uit.push(blok[i]);
    }
    for (let i = 0; i < ecPerBlok; i += 1) {
      for (const blok of correcties) uit.push(blok[i]);
    }
    return uit;
  }

  // ---- Het rooster -----------------------------------------------------------------
  function maakRooster(versie) {
    const maat = versie * 4 + 17;
    const rooster = [];
    const vast = [];
    for (let i = 0; i < maat; i += 1) {
      rooster.push(new Array(maat).fill(0));
      vast.push(new Array(maat).fill(false));
    }
    const zet = (x, y, waarde) => {
      if (x < 0 || y < 0 || x >= maat || y >= maat) return;
      rooster[y][x] = waarde;
      vast[y][x] = true;
    };

    // Zoekpatronen met scheidingsrand en de vaste donkere module.
    const zoekpatroon = (startX, startY) => {
      for (let y = -1; y <= 7; y += 1) {
        for (let x = -1; x <= 7; x += 1) {
          const rand = (x === -1 || x === 7 || y === -1 || y === 7);
          if (rand) { zet(startX + x, startY + y, 0); continue; }
          const buitenring = (x === 0 || x === 6 || y === 0 || y === 6);
          const hart = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
          zet(startX + x, startY + y, buitenring || hart ? 1 : 0);
        }
      }
    };
    zoekpatroon(0, 0);
    zoekpatroon(maat - 7, 0);
    zoekpatroon(0, maat - 7);

    // Tijdmarkeringen op regel 6 en kolom 6.
    for (let i = 8; i < maat - 8; i += 1) {
      zet(i, 6, i % 2 === 0 ? 1 : 0);
      zet(6, i, i % 2 === 0 ? 1 : 0);
    }

    // Uitlijnpatronen (niet waar ze de zoekpatronen zouden raken).
    const lijnen = LIJNEN[versie];
    for (const y of lijnen) {
      for (const x of lijnen) {
        if ((x === 6 && y === 6) || (x === 6 && y === maat - 7) || (x === maat - 7 && y === 6)) continue;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const rand = Math.max(Math.abs(dx), Math.abs(dy));
            zet(x + dx, y + dy, rand === 2 || rand === 0 ? 1 : 0);
          }
        }
      }
    }

    // Vaste donkere module en de plek van de indelings- en versiegegevens.
    zet(8, maat - 8, 1);
    for (let i = 0; i < 9; i += 1) {
      if (i !== 6) { zet(8, i, 0); zet(i, 8, 0); }
    }
    for (let i = 0; i < 8; i += 1) {
      zet(maat - 1 - i, 8, 0);          // bovenlangs, rechts van het zoekpatroon
      if (i < 7) zet(8, maat - 1 - i, 0); // linksonder; de vaste donkere module blijft staan
    }
    if (versie >= 7) {
      for (let y = 0; y < 6; y += 1) {
        for (let x = 0; x < 3; x += 1) {
          zet(maat - 11 + x, y, 0);
          zet(y, maat - 11 + x, 0);
        }
      }
    }
    return { rooster, vast, maat };
  }

  function bitsVanGetal(waarde, lengte) {
    const bits = [];
    for (let i = lengte - 1; i >= 0; i -= 1) bits.push((waarde >> i) & 1);
    return bits;
  }

  // BCH-rest voor de indelings- en versiegegevens.
  function bch(waarde, polynoom, restLengte) {
    // Gewone polynoomdeling: schuif het deelstreepje langs de bits en trek af (xor)
    // telkens als de hoogste bit overeenkomt.
    let rest = waarde << restLengte;
    const hoogste = 31 - Math.clz32(polynoom);
    for (let bit = 31 - Math.clz32(rest); bit >= hoogste; bit -= 1) {
      if ((rest >>> bit) & 1) rest ^= polynoom << (bit - hoogste);
    }
    return rest >>> 0;
  }

  function zetIndeling(rooster, vast, maat, masker) {
    const niveau = 0b00; // foutcorrectie M
    const gegevens = (niveau << 3) | masker;          // 5 bits: niveau en masker
    const waarde = gegevens << 10;                    // met 10 lege bits voor de correctie
    const bits = bitsVanGetal((waarde | bch(gegevens, 0b10100110111, 10)) ^ 0b101010000010010, 15);
    // De vijftien bits staan in twee stroken: langs kolom 8 (boven én onder het
    // zoekpatroon) en langs rij 8 (rechts én links). De minst belangrijke bit staat
    // vooraan in elke strook, zoals het formaat voorschrijft.
    const laag = bits.slice().reverse();
    for (let i = 0; i < 15; i += 1) {
      const bit = laag[i];
      const y = i < 6 ? i : (i === 6 ? 7 : (i === 7 ? 8 : maat - 15 + i));
      rooster[y][8] = bit;
      vast[y][8] = true;
      const x = i < 8 ? maat - 1 - i : (i === 8 ? 7 : 14 - i);
      rooster[8][x] = bit;
      vast[8][x] = true;
    }
  }

  function zetVersiegegevens(rooster, vast, maat, versie) {
    if (versie < 7) return;
    const waarde = versie << 12;
    const bits = bitsVanGetal(waarde | bch(versie, 0b1111100100101, 12), 18).reverse();
    for (let i = 0; i < 18; i += 1) {
      const bit = bits[i];
      const x = maat - 11 + (i % 3);
      const y = Math.floor(i / 3);
      rooster[y][x] = bit; vast[y][x] = true;
      rooster[x][y] = bit; vast[x][y] = true;
    }
  }

  function vulGegevens(rooster, vast, maat, bytes) {
    let richting = -1;
    let rij = maat - 1;
    let kolom = maat - 1;
    let bit = 0;
    const lees = () => {
      const waarde = bit < bytes.length * 8 ? (bytes[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
      bit += 1;
      return waarde;
    };
    while (kolom > 0) {
      if (kolom === 6) kolom -= 1; // de tijdmarkeringkolom slaan we over
      for (;;) {
        for (let i = 0; i < 2; i += 1) {
          const x = kolom - i;
          if (!vast[rij][x]) rooster[rij][x] = lees();
        }
        rij += richting;
        if (rij < 0 || rij >= maat) { rij -= richting; richting = -richting; break; }
      }
      kolom -= 2;
    }
  }

  const MASKERS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function pasMaskerToe(rooster, vast, maat, masker) {
    const uit = rooster.map(rij => rij.slice());
    const regel = MASKERS[masker];
    for (let y = 0; y < maat; y += 1) {
      for (let x = 0; x < maat; x += 1) {
        if (!vast[y][x] && regel(x, y)) uit[y][x] ^= 1;
      }
    }
    return uit;
  }

  // De vier strafregels uit de standaard: zo kiezen we het masker dat het rustigst leest.
  function straf(rooster, maat) {
    let punten = 0;
    const reeksen = (rijen) => {
      for (const rij of rijen) {
        let lengte = 1;
        for (let i = 1; i < rij.length; i += 1) {
          if (rij[i] === rij[i - 1]) lengte += 1;
          else {
            if (lengte >= 5) punten += 3 + (lengte - 5);
            lengte = 1;
          }
        }
        if (lengte >= 5) punten += 3 + (lengte - 5);
      }
    };
    const kolommen = [];
    for (let x = 0; x < maat; x += 1) {
      const kolom = [];
      for (let y = 0; y < maat; y += 1) kolom.push(rooster[y][x]);
      kolommen.push(kolom);
    }
    reeksen(rooster);
    reeksen(kolommen);

    for (let y = 0; y < maat - 1; y += 1) {
      for (let x = 0; x < maat - 1; x += 1) {
        const waarde = rooster[y][x];
        if (waarde === rooster[y][x + 1] && waarde === rooster[y + 1][x] && waarde === rooster[y + 1][x + 1]) punten += 3;
      }
    }

    const patroon = [1, 0, 1, 1, 1, 0, 1];
    for (const rij of rooster) {
      for (let i = 0; i + 7 <= rij.length; i += 1) {
        let gelijk = true;
        for (let j = 0; j < 7; j += 1) if (rij[i + j] !== patroon[j]) { gelijk = false; break; }
        if (!gelijk) continue;
        const voor = rij.slice(Math.max(0, i - 4), i).every(v => v === 0) && i >= 4;
        const na = rij.slice(i + 7, i + 11).every(v => v === 0) && i + 11 <= rij.length;
        if (voor || na) punten += 40;
      }
    }
    for (const kolom of kolommen) {
      for (let i = 0; i + 7 <= kolom.length; i += 1) {
        let gelijk = true;
        for (let j = 0; j < 7; j += 1) if (kolom[i + j] !== patroon[j]) { gelijk = false; break; }
        if (!gelijk) continue;
        const voor = kolom.slice(Math.max(0, i - 4), i).every(v => v === 0) && i >= 4;
        const na = kolom.slice(i + 7, i + 11).every(v => v === 0) && i + 11 <= kolom.length;
        if (voor || na) punten += 40;
      }
    }

    let donker = 0;
    for (const rij of rooster) for (const waarde of rij) donker += waarde;
    const deel = (donker * 100) / (maat * maat);
    punten += Math.floor(Math.abs(deel - 50) / 5) * 10;
    return punten;
  }

  function maakQr(tekst, opties) {
    const instellingen = opties || {};
    const bytes = [];
    const invoer = String(tekst == null ? '' : tekst);
    for (const teken of invoer) {
      const code = teken.codePointAt(0);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    if (!bytes.length) throw new Error('Er is geen tekst om een QR-code van te maken.');
    const versie = kiesVersie(bytes.length);
    if (!versie) throw new Error('Deze tekst is te lang voor een QR-code (maximaal ruim 200 tekens).');

    const gegevens = metFoutcorrectie(bitStroom(bytes, versie), versie);
    const { rooster, vast, maat } = maakRooster(versie);
    zetVersiegegevens(rooster, vast, maat, versie);
    vulGegevens(rooster, vast, maat, gegevens);

    let beste = null;
    let bestePunten = Infinity;
    for (let masker = 0; masker < 8; masker += 1) {
      const kandidaat = pasMaskerToe(rooster, vast, maat, masker);
      zetIndeling(kandidaat, vast.map(rij => rij.slice()), maat, masker);
      const punten = straf(kandidaat, maat);
      if (punten < bestePunten) { bestePunten = punten; beste = { modules: kandidaat, masker }; }
    }
    if (instellingen.masker != null) {
      const gekozen = pasMaskerToe(rooster, vast, maat, instellingen.masker);
      zetIndeling(gekozen, vast.map(rij => rij.slice()), maat, instellingen.masker);
      beste = { modules: gekozen, masker: instellingen.masker };
    }
    return { modules: beste.modules, maat, versie, masker: beste.masker, tekst: invoer };
  }

  const api = { maakQr, kiesVersie, databijtjes, BLOKKEN_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  wortel.maakQr = maakQr;
})(typeof window !== 'undefined' ? window : globalThis);
