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

  const staat = { locatie: '', zoek: '', laatste: '', scan: null, zoekTimer: null };
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
    const vak = $('#plaatZoek');
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
      const bron = uitkomst.bron ? `${esc(uitkomst.bron)} · ${esc(uitkomst.licentie || '')}` : '';
      const bewaard = uitkomst.cached ? ' · eerder opgezocht' : '';
      const soort = uitkomst.genre && uitkomst.genre !== 'Album' ? ` · ${esc(uitkomst.genre)}` : '';
      vak.innerHTML = `<strong>Herkend: ${esc(uitkomst.titel)}</strong><span class="mutedlink">${esc(uitkomst.artiest)}${uitkomst.jaar ? ' · ' + esc(uitkomst.jaar) : ''}${uitkomst.label ? ' · ' + esc(uitkomst.label) : ''}${soort}${bron ? ' · ' + bron : ''}${bewaard}</span>${uitkomst.hoes ? '' : '<span class="mutedlink">Van deze uitgave is geen hoes bekend; je kunt er zelf een notitie bij zetten.</span>'} <button class="mutedlink" type="button" id="plaatOpnieuw">Opnieuw zoeken</button>`;
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
    return `<article class="plaatKaart" data-plaat="${plaat.id}">
      <div class="hoes">${hoesBlok(plaat)}</div>
      <div class="plaatInfo">
        <strong>${esc(plaat.titel)}</strong>
        ${meta ? `<div class="plaatMeta">${meta}</div>` : ''}
        ${label}${notitie}
        ${Number(plaat.aantal) > 1 ? `<div class="plaatMeta">${Number(plaat.aantal)} exemplaren</div>` : ''}
      </div>
      <div class="plaatVoet">
        <select data-verplaats="${plaat.id}" aria-label="Locatie van deze plaat">
          ${locatieOpties(plaat.locatie)}
        </select>
        <button class="btn danger" type="button" data-weg="${plaat.id}" aria-label="Uit de verzameling halen">×</button>
      </div>
    </article>`;
  }

  function locatieOpties(gekozen) {
    const namen = staat.locaties && staat.locaties.length ? staat.locaties.map((l) => l.sleutel) : [];
    if (gekozen && !namen.includes(gekozen)) namen.push(gekozen);
    if (!namen.length) namen.push('Woonkamer');
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
      const knoppen = [`<button class="tab${staat.locatie ? '' : ' active'}" data-locatie="">Alles <span>${gegevens.totaal}</span></button>`];
      for (const l of staat.locaties) {
        const actief = staat.locatie === l.sleutel ? ' active' : '';
        knoppen.push(`<button class="tab${actief}" data-locatie="${esc(l.sleutel)}">${esc(l.naam)} <span>${l.aantal}</span></button>`);
      }
      tabs.innerHTML = knoppen.join('');
    }
    const lijst = $('#plaatLocaties');
    if (lijst) {
      lijst.innerHTML = staat.locaties.map((l) => `<option value="${esc(l.sleutel)}"></option>`).join('') + '<option value="Woonkamer"></option><option value="Zolder"></option><option value="Mama"></option>';
    }
  }

  function teken(gegevens) {
    tekenLocaties(gegevens);
    const grid = $('#plaatGrid');
    const leeg = $('#plaatLeeg');
    const pill = $('#platenTotaal');
    if (pill) pill.textContent = `${gegevens.totaal} ${gegevens.totaal === 1 ? 'plaat' : 'platen'}${gegevens.stuks > gegevens.totaal ? ` · ${gegevens.stuks} exemplaren` : ''}`;
    if (!grid) return;
    if (!gegevens.platen.length) {
      grid.innerHTML = '';
      if (leeg) {
        leeg.hidden = false;
        leeg.textContent = staat.zoek
          ? 'Geen plaat gevonden met die zoekterm.'
          : 'Nog geen platen op deze plek. Scan een barcode of vul de gegevens zelf in.';
      }
      return;
    }
    if (leeg) leeg.hidden = true;
    grid.innerHTML = gegevens.platen.map(kaart).join('');
  }

  async function laad() {
    const vraag = new URLSearchParams();
    if (staat.locatie) vraag.set('locatie', staat.locatie);
    if (staat.zoek) vraag.set('q', staat.zoek);
    const gegevens = await api(`/api/platen${vraag.toString() ? '?' + vraag.toString() : ''}`);
    teken(gegevens);
    return gegevens;
  }

  async function bewaar(gebeurtenis) {
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
      locatie: waarde('#plaatLocatie'),
      notitie: waarde('#plaatNotitie'),
      aantal: waarde('#plaatAantal') || 1,
    };
    try {
      const uitkomst = await stuurJson('/api/platen', 'POST', gegevens);
      meld(uitkomst.opgeteld
        ? `${gegevens.titel} staat al op ${gegevens.locatie || 'deze plek'}; het aantal is opgehoogd.`
        : `${uitkomst.plaat.titel} staat nu in je verzameling${gegevens.locatie ? ' op ' + gegevens.locatie : ''}.`);
      if (veld('#plaatForm')) veld('#plaatForm').reset();
      if (veld('#plaatAantal')) veld('#plaatAantal').value = 1;
      toonHoes('');
      const zoekvak = $('#plaatZoek');
      if (zoekvak) { zoekvak.hidden = true; zoekvak.innerHTML = ''; }
      staat.laatste = '';
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
          const weg = gebeurtenis.target.closest('[data-weg]');
          if (!weg) return;
          if (!window.confirm('Deze plaat uit je verzameling halen?')) return;
          try {
            await api(`/api/platen/${weg.dataset.weg}`, { method: 'DELETE' });
            meld('Plaat uit de verzameling gehaald.');
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
