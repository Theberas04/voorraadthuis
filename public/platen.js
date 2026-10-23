// De platenpagina: lp's toevoegen door de barcode te scannen of te typen, met alle
// gegevens en de hoes in het overzicht, en de verzameling per locatie bekijken.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (pad, opties) => {
    const antwoord = await fetch(pad, opties);
    const gegevens = await antwoord.json().catch(() => ({}));
    if (!antwoord.ok) throw Error(gegevens.error || 'Er ging iets mis.');
    return gegevens;
  };
  const stuurJson = (pad, methode, lichaam) => api(pad, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(lichaam) });

  const staat = { locatie: '', zoek: '', genre: '', artiest: '', decennium: '', van: '', tot: '', gewenst: false, laatste: '', scan: null, zoekTimer: null, jaarTimer: null, catalogusTimer: null };
  let geopend = false;

  const veld = (id) => $(id);
  const waarde = (id) => (veld(id) ? veld(id).value.trim() : '');

  function meld(tekst, fout) {
    const vak = $('#plaatNotice');
    if (!vak) return;
    vak.textContent = tekst || '';
    vak.classList.toggle('fout', !!fout);
  }

  function toonHoes(url) {
    const vak = $('#plaatHoesVak'), img = $('#plaatHoes');
    if (!vak || !img) return;
    if (url) {
      img.onerror = () => { vak.hidden = true; };
      img.src = url;
      vak.hidden = false;
    } else {
      img.removeAttribute('src');
      vak.hidden = true;
    }
  }

  function vulIn(plaat) {
    if (veld('#plaatTitel')) veld('#plaatTitel').value = plaat.titel || '';
    if (veld('#plaatArtiest')) veld('#plaatArtiest').value = plaat.artiest || '';
    if (veld('#plaatJaar')) veld('#plaatJaar').value = plaat.jaar || '';
    if (veld('#plaatFormaat')) veld('#plaatFormaat').value = plaat.formaat || '';
    if (veld('#plaatLabel')) veld('#plaatLabel').value = plaat.label || '';
    if (veld('#plaatNotitie') && plaat.genre) veld('#plaatNotitie').dataset.genre = plaat.genre;
    toonHoes(plaat.hoes || '');
  }

  async function zoekBarcode(code, geforceerd) {
    const schoon = String(code || '').replace(/\D/g, '');
    const vak = $('#plaatZoekVak');
    if (!vak) return;
    if (schoon.length < 8) { vak.hidden = true; vak.innerHTML = ''; return; }
    if (!geforceerd && schoon === staat.laatste && !vak.hidden) return;
    staat.laatste = schoon;
    vak.hidden = false;
    vak.innerHTML = '<strong>Plaat opzoeken…</strong>';
    try {
      const uitkomst = await api(`/api/platen/zoek?code=${encodeURIComponent(schoon)}${geforceerd ? '&force=1' : ''}`);
      if (!uitkomst.gevonden) {
        toonHoes('');
        const kop = uitkomst.reason === 'storing' || uitkomst.storing ? 'De databank is even niet bereikbaar' : 'Deze barcode staat niet in de databank';
        const raad = uitkomst.message || 'Vul de titel en artiest zelf in; de app bewaart ze bij deze barcode, dus de volgende keer wordt de plaat meteen herkend.';
        vak.innerHTML = `<strong>${esc(kop)}</strong><span class="mutedlink">${esc(raad)}</span> <button class="mutedlink" type="button" id="plaatOpnieuw">Opnieuw zoeken</button>`;
        const nog = $('#plaatOpnieuw');
        if (nog) nog.onclick = () => zoekBarcode(schoon, true);
        return;
      }
      vulIn(uitkomst);
      if (uitkomst.barcode && uitkomst.barcode !== schoon && veld('#plaatBarcode')) {
        veld('#plaatBarcode').value = uitkomst.barcode;
        staat.laatste = uitkomst.barcode;
      }
      const bron = [uitkomst.bron, uitkomst.licentie].filter(Boolean).map(esc).join(' · ');
      const bronLink = uitkomst.bronUrl ? `<a href="${esc(uitkomst.bronUrl)}" target="_blank" rel="noopener noreferrer">Bron</a>` : '';
      const bewaard = uitkomst.cached ? ' · eerder opgezocht' : '';
      const soort = uitkomst.genre && uitkomst.genre !== 'Album' ? ` · ${esc(uitkomst.genre)}` : '';
      vak.innerHTML = `<strong>Herkend: ${esc(uitkomst.titel)}</strong><span class="mutedlink">${esc(uitkomst.artiest)}${uitkomst.jaar ? ' · ' + esc(uitkomst.jaar) : ''}${uitkomst.label ? ' · ' + esc(uitkomst.label) : ''}${soort}${bron ? ' · ' + bron : ''}${bronLink ? ' · ' + bronLink : ''}${bewaard}</span>${uitkomst.hoes ? '' : '<span class="mutedlink">Van deze uitgave is geen hoes bekend; je kunt er zelf een notitie bij zetten.</span>'} <button class="mutedlink" type="button" id="plaatOpnieuw">Opnieuw zoeken</button>`;
      const opnieuw = $('#plaatOpnieuw');
      if (opnieuw) opnieuw.onclick = () => zoekBarcode(schoon, true);
    } catch (fout) {
      vak.innerHTML = `<strong>Opzoeken mislukt</strong><span class="mutedlink">${esc(fout.message)}</span>`;
    }
  }

  function hoesBlok(plaat) {
    if (plaat.hoes) {
      return `<img src="${esc(plaat.hoes)}" alt="Hoes van ${esc(plaat.titel)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'geenhoes',textContent:'Geen hoes bekend'}))">`;
    }
    const begin = (plaat.artiest || plaat.titel || '?').trim().charAt(0).toUpperCase();
    return `<div class="geenhoes"><span class="plaatBegin">${esc(begin)}</span><span>Geen hoes bekend</span></div>`;
  }

  function kaart(plaat) {
    const meta = [plaat.artiest, plaat.jaar, plaat.formaat].filter(Boolean).map(esc).join(' · ');
    const label = plaat.label ? `<div class="plaatMeta">${esc(plaat.label)}</div>` : '';
    const notitie = plaat.notitie ? `<div class="plaatMeta">${esc(plaat.notitie)}</div>` : '';
    const voet = plaat.gewenst
      ? `<button class="btn primary" type="button" data-wens-hebben="${plaat.id}">Heb ik nu</button><button class="btn danger" type="button" data-weg="${plaat.id}" aria-label="Van verlanglijst halen">×</button>`
      : `<select data-verplaats="${plaat.id}" aria-label="Locatie van deze plaat">${locatieOpties(plaat.locatie)}</select><button class="btn danger" type="button" data-weg="${plaat.id}" aria-label="Uit de verzameling halen">×</button>`;
    return `<article class="plaatKaart${plaat.gewenst ? ' plaatGewenst' : ''}" data-plaat="${plaat.id}">
      <div class="hoes">${hoesBlok(plaat)}</div>
      <div class="plaatInfo">
        <strong>${esc(plaat.titel)}</strong>
        ${meta ? `<div class="plaatMeta">${meta}</div>` : ''}
        ${label}${notitie}
        ${plaat.gewenst ? `<label class="plaatPrijs">Richtprijs (€)<input data-prijs="${plaat.id}" type="number" min="0" max="100000" step="0.01" value="${plaat.prijs == null ? '' : Number(plaat.prijs).toFixed(2)}" placeholder="Nog invullen"></label>` : ''}
        ${Number(plaat.aantal) > 1 ? `<div class="plaatMeta">${Number(plaat.aantal)} exemplaren</div>` : ''}
      </div>
      <div class="plaatVoet">${voet}</div>
    </article>`;
  }

  function tekenVerlanglijstTabs() {
    const tabs = $('#platenVerlanglijstTabs');
    if (!tabs) return;
    tabs.innerHTML = `<button class="tab${staat.gewenst ? '' : ' active'}" type="button" data-platen-status="bezit">Mijn verzameling</button><button class="tab${staat.gewenst ? ' active' : ''}" type="button" data-platen-status="wens">Verlanglijst</button>`;
    const titel = $('#plaatLijstTitel');
    if (titel) titel.textContent = staat.gewenst ? 'Mijn verlanglijst' : 'Mijn verzameling';
    const lijstZoek = $('#plaatZoek');
    if (lijstZoek) {
      lijstZoek.placeholder = staat.gewenst ? 'Zoek in mijn verlanglijst' : 'Zoek in mijn verzameling';
      lijstZoek.setAttribute('aria-label', lijstZoek.placeholder);
    }
    const filters = $('#plaatFilters');
    const filterStand = $('#plaatFilterStand');
    const locaties = $('#plaatLocatieTabs');
    const invoer = $('#plaatToevoegenPanel');
    const catalogus = $('#plaatVerlanglijstZoekPanel');
    if (filters) filters.hidden = staat.gewenst;
    if (filterStand) filterStand.hidden = staat.gewenst;
    if (locaties) locaties.hidden = staat.gewenst;
    if (invoer) invoer.hidden = staat.gewenst;
    if (catalogus) catalogus.hidden = !staat.gewenst;
  }

  function locatieOpties(gekozen) {
    const namen = staat.locaties && staat.locaties.length ? staat.locaties.map((l) => l.sleutel) : [];
    if (gekozen && !namen.includes(gekozen)) namen.push(gekozen);
    const opties = [`<option value=""${gekozen ? '' : ' selected'}>Zonder locatie</option>`];
    for (const naam of namen) {
      opties.push(`<option value="${esc(naam)}"${naam === gekozen ? ' selected' : ''}>${esc(naam)}</option>`);
    }
    // Zo kun je een plaat ook naar een plek verhuizen die nog niet in de lijst staat.
    opties.push('<option value="__nieuw">+ Andere locatie…</option>');
    return opties.join('');
  }

  function tekenLocaties(gegevens) {
    staat.locaties = gegevens.locaties || [];
    const tabs = $('#plaatLocatieTabs');
    if (tabs) {
      const knoppen = [`<button class="tab${staat.locatie ? '' : ' active'}" data-locatie="">Alles <span>${gegevens.alleTotaal || gegevens.totaal}</span></button>`];
      for (const l of staat.locaties) {
        const actief = staat.locatie === l.sleutel ? ' active' : '';
        knoppen.push(`<button class="tab${actief}" data-locatie="${esc(l.sleutel)}">${esc(l.naam)} <span>${l.aantal}</span></button>`);
      }
      tabs.innerHTML = knoppen.join('');
    }
    const lijst = $('#plaatLocaties');
    if (lijst) {
      // Alleen de plekken die je zelf gebruikt; je typt zo een nieuwe plek erbij.
      lijst.innerHTML = staat.locaties.filter((l) => l.sleutel).map((l) => `<option value="${esc(l.sleutel)}"></option>`).join('');
    }
  }

  function teken(gegevens) {
    tekenVerlanglijstTabs();
    tekenLocaties(gegevens);
    vulKeuzelijsten(gegevens);
    tekenFilterStand(gegevens);
    const grid = $('#plaatGrid');
    const leeg = $('#plaatLeeg');
    const pill = $('#platenTotaal');
    const gemiddelde = $('#platenGemiddelde');
    if (pill) pill.textContent = `${gegevens.totaal} ${gegevens.totaal === 1 ? 'plaat' : 'platen'}${gegevens.stuks > gegevens.totaal ? ` · ${gegevens.stuks} exemplaren` : ''}`;
    if (gemiddelde) {
      gemiddelde.hidden = !staat.gewenst;
      gemiddelde.textContent = gegevens.gemiddeldePrijs == null
        ? 'Gemiddelde richtprijs: nog geen prijzen ingevuld'
        : `Gemiddelde richtprijs: ${Number(gegevens.gemiddeldePrijs).toLocaleString('nl-NL', {style: 'currency', currency: 'EUR'})} (${gegevens.prijsAantal} met prijs)`;
    }
    if (!grid) return;
    if (!gegevens.platen.length) {
      grid.innerHTML = '';
      if (leeg) {
        leeg.hidden = false;
        const gefilterd = staat.zoek || staat.genre || staat.artiest || staat.decennium || staat.van || staat.tot || staat.locatie;
        leeg.textContent = staat.gewenst
          ? 'Je verlanglijst is nog leeg. Scan een barcode en kies “Aan verlanglijst toevoegen”.'
          : gefilterd
            ? 'Geen plaat die bij deze filters past. Zet een filter uit of wis ze allemaal met “Filters wissen”.'
            : 'Nog geen platen op deze plek. Scan een barcode of vul de gegevens zelf in.';
      }
      return;
    }
    if (leeg) leeg.hidden = true;
    grid.innerHTML = gegevens.platen.map(kaart).join('');
  }

  // De keuzelijsten (genre, artiest, decennium) komen uit de hele verzameling. Een keuze
  // die je al gemaakt hebt blijft staan, ook als de lijst opnieuw gevuld wordt.
  function toonWensResultaten(resultaten, zoekterm) {
    const vak = $('#plaatWensResultaten');
    if (!vak) return;
    if (!resultaten.length) {
      vak.innerHTML = `<p class="hint">Geen platen gevonden voor “${esc(zoekterm)}” in de lokale barcodelijst.</p>`;
      return;
    }
    vak.innerHTML = resultaten.map((plaat) => {
      const meta = [plaat.artiest, plaat.jaar, plaat.formaat].filter(Boolean).map(esc).join(' · ');
      return `<article class="wensZoekResultaat">
        <strong>${esc(plaat.titel)}</strong><div class="wensZoekMeta">${meta || 'Vinyluitgave'} · barcode ${esc(plaat.barcode)}</div>
        <div class="wensZoekActies"><label class="wensZoekPrijs">Richtprijs (€)<input data-catalog-prijs type="number" min="0" max="100000" step="0.01" placeholder="Optioneel"></label>
        <button class="btn primary" type="button" data-wens-add="${esc(plaat.barcode)}" data-titel="${esc(plaat.titel)}" data-artiest="${esc(plaat.artiest)}" data-jaar="${esc(plaat.jaar)}" data-label="${esc(plaat.label)}" data-formaat="${esc(plaat.formaat)}" data-hoes="${esc(plaat.hoes)}">♡ Op lijst</button></div>
      </article>`;
    }).join('');
  }

  async function zoekWensCatalogus(zoekterm) {
    const melding = $('#plaatWensZoekMelding');
    const vak = $('#plaatWensResultaten');
    if (!zoekterm || zoekterm.length < 2) {
      if (melding) melding.textContent = 'Typ minimaal twee letters om in de lokale lp-lijst te zoeken.';
      if (vak) vak.innerHTML = '';
      return;
    }
    if (melding) { melding.classList.remove('fout'); melding.textContent = 'Zoeken in de lokale lp-barcodelijst…'; }
    try {
      const gegevens = await api(`/api/platen/catalogus?q=${encodeURIComponent(zoekterm)}`);
      if (zoekterm !== waarde('#plaatWensZoek')) return;
      toonWensResultaten(gegevens.resultaten || [], zoekterm);
      if (melding) melding.textContent = `${(gegevens.resultaten || []).length} resultaten (maximaal 30).`;
    } catch (fout) {
      if (melding) { melding.textContent = fout.message; melding.classList.add('fout'); }
    }
  }

  function vulKeuzelijsten(gegevens) {
    const keuzes = gegevens.keuzelijsten || {};
    const vul = (id, items, eigenTekst, gekozen) => {
      const vak = $(id);
      if (!vak) return;
      const opties = [`<option value="">${eigenTekst}</option>`];
      for (const it of items || []) {
        const naam = it.naam;
        const label = it.label || naam;
        opties.push(`<option value="${esc(naam)}"${String(naam) === String(gekozen || '') ? ' selected' : ''}>${esc(label)} (${it.aantal})</option>`);
      }
      vak.innerHTML = opties.join('');
      if (gekozen && ![...vak.options].some((o) => o.value === String(gekozen))) vak.value = '';
    };
    vul('#plaatGenre', keuzes.genres, 'Alle genres', staat.genre);
    vul('#plaatArtiestFilter', keuzes.artiesten, 'Alle artiesten', staat.artiest);
    vul('#plaatDecennium', keuzes.decennia, 'Alle jaartallen', staat.decennium);
  }

  // Laat zien wat er gefilterd is, zodat je nooit voor een lege lijst staat zonder te
  // weten waarom.
  function tekenFilterStand(gegevens) {
    const vak = $('#plaatFilterStand');
    if (!vak) return;
    const actief = [];
    if (staat.genre) actief.push(`genre ${staat.genre === 'onbekend' ? 'onbekend' : staat.genre}`);
    if (staat.artiest) actief.push(`artiest ${staat.artiest === 'onbekend' ? 'onbekend' : staat.artiest}`);
    if (staat.decennium) actief.push(staat.decennium === 'onbekend' ? 'jaar onbekend' : `decennium ${staat.decennium}`);
    if (staat.van) actief.push(`vanaf ${staat.van}`);
    if (staat.tot) actief.push(`tot ${staat.tot}`);
    if (staat.locatie) actief.push(`locatie ${staat.locatie}`);
    if (staat.zoek) actief.push(`zoekterm “${staat.zoek}”`);
    const totaal = gegevens.alleTotaal || gegevens.totaal;
    vak.innerHTML = actief.length
      ? `Gefilterd op ${actief.map(esc).join(', ')} — <strong>${gegevens.totaal}</strong> van ${totaal} platen.`
      : `Alle <strong>${gegevens.totaal}</strong> platen. Filter op genre, artiest, jaartal of decennium.`;
    const wis = $('#plaatWisFilters');
    if (wis) wis.disabled = !actief.length;
  }

  async function laad() {
    const vraag = new URLSearchParams();
    if (staat.gewenst) {
      vraag.set('status', 'wens');
      if (staat.zoek) vraag.set('q', staat.zoek);
    } else {
      if (staat.locatie) vraag.set('locatie', staat.locatie);
      if (staat.zoek) vraag.set('q', staat.zoek);
      if (staat.genre) vraag.set('genre', staat.genre);
      if (staat.artiest) vraag.set('artiest', staat.artiest);
      if (staat.decennium) vraag.set('decennium', staat.decennium);
      if (staat.van) vraag.set('van', staat.van);
      if (staat.tot) vraag.set('tot', staat.tot);
    }
    const gegevens = await api(`/api/platen${vraag.toString() ? '?' + vraag.toString() : ''}`);
    gegevens.alleTotaal = (gegevens.keuzelijsten && gegevens.keuzelijsten.locaties || []).reduce((som, l) => som + l.aantal, 0) || gegevens.totaal;
    teken(gegevens);
    return gegevens;
  }

  async function bewaar(gebeurtenis, zetOpVerlanglijst = false) {
    if (gebeurtenis) gebeurtenis.preventDefault();
    const titel = waarde('#plaatTitel');
    if (!titel) { meld('Vul in elk geval de titel van de plaat in.', true); return; }
    const gegevens = {
      barcode: waarde('#plaatBarcode').replace(/\D/g, ''),
      titel,
      artiest: waarde('#plaatArtiest'),
      jaar: waarde('#plaatJaar'),
      label: waarde('#plaatLabel'),
      formaat: waarde('#plaatFormaat'),
      genre: ($('#plaatNotitie') && $('#plaatNotitie').dataset.genre) || '',
      hoes: $('#plaatHoes') && $('#plaatHoes').getAttribute('src') ? $('#plaatHoes').src : '',
      locatie: zetOpVerlanglijst ? '' : waarde('#plaatLocatie'),
      notitie: waarde('#plaatNotitie'),
      aantal: waarde('#plaatAantal') || 1,
      gewenst: zetOpVerlanglijst,
    };
    try {
      const uitkomst = await stuurJson('/api/platen', 'POST', gegevens);
      if (uitkomst.alInVerzameling) meld(`${uitkomst.plaat.titel} staat al in je verzameling.`);
      else if (uitkomst.bestondAl) meld(`${gegevens.titel} staat al op je verlanglijst.`);
      else if (zetOpVerlanglijst) meld(`${uitkomst.plaat.titel} staat op je verlanglijst.`);
      else if (uitkomst.gekocht) meld(`${uitkomst.plaat.titel} staat nu in je verzameling${gegevens.locatie ? ' op ' + gegevens.locatie : ''}.`);
      else meld(uitkomst.opgeteld
        ? `${gegevens.titel} staat al op ${gegevens.locatie || 'deze plek'}; het aantal is opgehoogd.`
        : `${uitkomst.plaat.titel} staat nu in je verzameling${gegevens.locatie ? ' op ' + gegevens.locatie : ''}.`);
      if (veld('#plaatForm')) veld('#plaatForm').reset();
      if (veld('#plaatAantal')) veld('#plaatAantal').value = 1;
      toonHoes('');
      const zoekvak = $('#plaatZoekVak');
      if (zoekvak) { zoekvak.hidden = true; zoekvak.innerHTML = ''; }
      staat.laatste = '';
      staat.gewenst = zetOpVerlanglijst && !uitkomst.alInVerzameling;
      await laad();
    } catch (fout) {
      meld(fout.message, true);
    }
  }

  function open() {
    if (!geopend) {
      geopend = true;
      const form = $('#plaatForm');
      if (form) form.addEventListener('submit', bewaar);
      const wensKnop = $('#plaatWensButton');
      if (wensKnop) wensKnop.addEventListener('click', (gebeurtenis) => bewaar(gebeurtenis, true));
      const lijstTabs = $('#platenVerlanglijstTabs');
      if (lijstTabs) lijstTabs.addEventListener('click', async (gebeurtenis) => {
        const knop = gebeurtenis.target.closest('[data-platen-status]');
        if (!knop) return;
        const volgende = knop.dataset.platenStatus === 'wens';
        if (staat.gewenst !== volgende) {
          staat.gewenst = volgende;
          staat.zoek = '';
          if ($('#plaatZoek')) $('#plaatZoek').value = '';
        }
        await laad();
      });
      const wensZoek = $('#plaatWensZoek');
      if (wensZoek) wensZoek.addEventListener('input', () => {
        clearTimeout(staat.catalogusTimer);
        staat.catalogusTimer = setTimeout(() => zoekWensCatalogus(wensZoek.value.trim()), 280);
      });
      const wensResultaten = $('#plaatWensResultaten');
      if (wensResultaten) wensResultaten.addEventListener('click', async (gebeurtenis) => {
        const knop = gebeurtenis.target.closest('[data-wens-add]');
        if (!knop) return;
        const item = knop.closest('.wensZoekResultaat');
        const prijs = item && item.querySelector('[data-catalog-prijs]') ? item.querySelector('[data-catalog-prijs]').value : '';
        try {
          const uitkomst = await stuurJson('/api/platen', 'POST', {
            barcode: knop.dataset.wensAdd, titel: knop.dataset.titel, artiest: knop.dataset.artiest,
            jaar: knop.dataset.jaar, label: knop.dataset.label, formaat: knop.dataset.formaat,
            hoes: knop.dataset.hoes, gewenst: true, prijs,
          });
          if (uitkomst.alInVerzameling) meld(`${uitkomst.plaat.titel} staat al in je verzameling.`);
          else meld(uitkomst.bestondAl ? `${uitkomst.plaat.titel} stond al op je verlanglijst; de prijs is bijgewerkt.` : `${uitkomst.plaat.titel} is aan je verlanglijst toegevoegd.`);
          staat.gewenst = true;
          await laad();
        } catch (fout) { meld(fout.message, true); }
      });
      const barcode = $('#plaatBarcode');
      if (barcode) {
        barcode.addEventListener('input', () => {
          clearTimeout(staat.zoekTimer);
          staat.zoekTimer = setTimeout(() => zoekBarcode(barcode.value), 350);
        });
        barcode.addEventListener('blur', () => zoekBarcode(barcode.value));
      }
      const zoek = $('#plaatZoek');
      if (zoek) {
        let timer;
        zoek.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(async () => { staat.zoek = zoek.value.trim(); await laad(); }, 250);
        });
      }
      // Filters: genre, artiest, decennium en jaartal. Ze werken allemaal tegelijk en
      // naast de locatietabs en het zoekveld.
      const keuze = (id, veldNaam) => {
        const vak = $(id);
        if (!vak) return;
        vak.addEventListener('change', async () => { staat[veldNaam] = vak.value; await laad(); });
      };
      keuze('#plaatGenre', 'genre');
      keuze('#plaatArtiestFilter', 'artiest');
      keuze('#plaatDecennium', 'decennium');
      const jaarVeld = (id, veldNaam) => {
        const vak = $(id);
        if (!vak) return;
        vak.addEventListener('input', () => {
          clearTimeout(staat.jaarTimer);
          staat.jaarTimer = setTimeout(async () => {
            staat[veldNaam] = vak.value.trim();
            await laad();
          }, 400);
        });
      };
      jaarVeld('#plaatVan', 'van');
      jaarVeld('#plaatTot', 'tot');
      const wis = $('#plaatWisFilters');
      if (wis) {
        wis.addEventListener('click', async () => {
          staat.genre = staat.artiest = staat.decennium = staat.van = staat.tot = '';
          for (const id of ['#plaatGenre', '#plaatArtiestFilter', '#plaatDecennium']) if ($(id)) $(id).value = '';
          for (const id of ['#plaatVan', '#plaatTot']) if ($(id)) $(id).value = '';
          await laad();
        });
      }
      const tabs = $('#plaatLocatieTabs');
      if (tabs) {
        tabs.addEventListener('click', async (gebeurtenis) => {
          const knop = gebeurtenis.target.closest('[data-locatie]');
          if (!knop) return;
          staat.locatie = knop.dataset.locatie;
          await laad();
        });
      }
      const grid = $('#plaatGrid');
      if (grid) {
        grid.addEventListener('change', async (gebeurtenis) => {
          const prijsveld = gebeurtenis.target.closest('[data-prijs]');
          if (prijsveld) {
            try {
              await stuurJson(`/api/platen/${prijsveld.dataset.prijs}`, 'PATCH', {prijs: prijsveld.value});
              meld(prijsveld.value === '' ? 'Richtprijs gewist.' : 'Richtprijs opgeslagen.');
              await laad();
            } catch (fout) { meld(fout.message, true); }
            return;
          }
          const keuze = gebeurtenis.target.closest('[data-verplaats]');
          if (!keuze) return;
          let locatie = keuze.value;
          if (locatie === '__nieuw') {
            const ingevoerd = window.prompt('Naar welke plek verhuist deze plaat?', '');
            const schoon = (ingevoerd || '').trim().slice(0, 60);
            if (!schoon) { await laad(); return; }
            locatie = schoon;
          }
          try {
            await stuurJson(`/api/platen/${keuze.dataset.verplaats}`, 'PATCH', { locatie });
            meld(locatie ? `Plaat verhuisd naar ${locatie}.` : 'Locatie gewist.');
            await laad();
          } catch (fout) { meld(fout.message, true); }
        });
        grid.addEventListener('click', async (gebeurtenis) => {
          const hebben = gebeurtenis.target.closest('[data-wens-hebben]');
          if (hebben) {
            try {
              const plaat = await stuurJson(`/api/platen/${hebben.dataset.wensHebben}`, 'PATCH', { gewenst: false, locatie: '' });
              staat.gewenst = false;
              meld(`${plaat.titel || 'De plaat'} staat nu in je verzameling. Je kunt de locatie daarna kiezen.`);
              await laad();
            } catch (fout) { meld(fout.message, true); }
            return;
          }
          const weg = gebeurtenis.target.closest('[data-weg]');
          if (!weg) return;
          if (!window.confirm(staat.gewenst ? 'Deze plaat van je verlanglijst halen?' : 'Deze plaat uit je verzameling halen?')) return;
          try {
            await api(`/api/platen/${weg.dataset.weg}`, { method: 'DELETE' });
            meld(staat.gewenst ? 'Plaat van je verlanglijst gehaald.' : 'Plaat uit de verzameling gehaald.');
            await laad();
          } catch (fout) { meld(fout.message, true); }
        });
      }
      const scanKnop = $('#plaatScan');
      if (scanKnop) scanKnop.onclick = scanCamera;
    }
    laad().catch((fout) => meld(fout.message, true));
  }

  // De camera werkt alleen op een beveiligde verbinding (https); typen kan altijd.
  async function scanCamera() {
    const video = $('#plaatCamera');
    if (!window.isSecureContext) {
      meld('Scannen met de camera kan alleen via https. Typ de barcode in het veld; die wordt meteen herkend.', true);
      return;
    }
    if (!('BarcodeDetector' in window)) {
      meld('Deze browser ondersteunt geen barcodescanner. Typ de barcode in het veld.', true);
      return;
    }
    try {
      if (staat.scan) {
        staat.scan.getTracks().forEach((t) => t.stop());
        staat.scan = null;
        if (video) video.hidden = true;
        return;
      }
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'] });
      staat.scan = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = staat.scan;
      video.hidden = false;
      await video.play();
      const kijk = async () => {
        if (!staat.scan) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const code = codes[0].rawValue;
            staat.scan.getTracks().forEach((t) => t.stop());
            staat.scan = null;
            video.hidden = true;
            if (veld('#plaatBarcode')) veld('#plaatBarcode').value = code;
            meld('Barcode gescand.');
            zoekBarcode(code);
            return;
          }
        } catch { /* volgende beeld */ }
        requestAnimationFrame(kijk);
      };
      kijk();
    } catch {
      meld('Camera niet beschikbaar. Controleer de toestemming of typ de barcode in het veld.', true);
    }
  }

  window.Platen = { open, laad, zoekBarcode, bewaar };
})();
