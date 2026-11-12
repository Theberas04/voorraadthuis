/* Puzzels: de legpuzzelverzameling. Scannen of typen van de barcode, opzoeken bij de
   bron (Open Products Facts), zelf invullen wat je weet, en alles lokaal bewaren.
   Foto's uit de databank nemen we niet over; je ziet je eigen foto van de doos. */
(function () {
  const $ = (kies) => document.querySelector(kies);
  const staat = {puzzels: [], keuzelijsten: null, bron: null, scan: null, bewerken: null, stukken: []};

  const esc = (tekst) => String(tekst == null ? '' : tekst).replace(/[&<>"']/g, (teken) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[teken]));

  async function api(pad, opties) {
    const antwoord = await fetch(pad, opties);
    const gegevens = await antwoord.json().catch(() => ({}));
    if (!antwoord.ok) throw Error(gegevens.error || 'Er ging iets mis.');
    return gegevens;
  }

  const meld = (tekst, fout) => {
    const vak = $('#puzzelNotice');
    vak.textContent = tekst;
    vak.className = fout ? 'notice fout' : 'notice';
  };

  // ---- Het overzicht ------------------------------------------------------------
  function filters() {
    return {
      q: $('#puzzelZoek').value.trim(),
      merk: $('#puzzelMerkFilter').value,
      stukken: $('#puzzelStukkenFilter').value,
      status: $('#puzzelStatusFilter').value,
      locatie: $('#puzzelLocatieFilter').value,
    };
  }

  // De printbare lijst en de CSV nemen de filters mee die nu aanstaan: druk je af met
  // 'alleen uitgeleend' gekozen, dan staat dat er ook zo op papier.
  function werkLijstKoppen() {
    const tekst = new URLSearchParams(Object.entries(filters()).filter(([, waarde]) => waarde)).toString();
    const staart = tekst ? `?${tekst}` : '';
    $('#puzzelLijst').href = `/api/puzzels/lijst${staart}`;
    $('#puzzelLijstCsv').href = `/api/puzzels/lijst.csv${staart}`;
  }

  async function laad() {
    werkLijstKoppen();
    const vraag = new URLSearchParams(Object.entries(filters()).filter(([, waarde]) => waarde));
    const gegevens = await api(`/api/puzzels?${vraag.toString()}`);
    staat.puzzels = gegevens.puzzels;
    staat.keuzelijsten = gegevens.keuzelijsten;
    staat.bron = gegevens.bron;
    teken();
  }

  function teken() {
    const lijst = staat.keuzelijsten || {merken: [], stukken: [], locaties: [], soorten: []};
    $('#puzzelTotaal').textContent = `${staat.puzzels.reduce((som, p) => som + (p.aantal || 1), 0)} puzzels`;
    vulKeuze($('#puzzelMerkFilter'), lijst.merken.map((m) => ({waarde: m.naam, tekst: `${m.naam} (${m.aantal})`})), 'Alle merken');
    vulKeuze($('#puzzelStukkenFilter'), lijst.stukken.map((s) => ({waarde: s.naam, tekst: `${s.naam} stukken (${s.aantal})`})), 'Alle aantallen');
    vulKeuze($('#puzzelLocatieFilter'), lijst.locaties.map((l) => ({waarde: l.naam, tekst: `${l.naam} (${l.aantal})`})), 'Alle plekken');
    vulKeuze($('#puzzelStatusFilter'), (lijst.statussen || []).map((s) => ({waarde: s.status, tekst: s.naam})), 'Alle statussen');
    vulDatalist($('#puzzelLocaties'), lijst.locaties.map((l) => l.naam));
    vulDatalist($('#puzzelMerken'), lijst.merken.map((m) => m.naam));
    vulDatalist($('#puzzelSoorten'), lijst.soorten || []);

    const rooster = $('#puzzelGrid');
    rooster.innerHTML = staat.puzzels.length
      ? staat.puzzels.map(kaart).join('')
      : '<p class="hint">Nog geen puzzels in deze selectie. Scan de barcode van een doos of vul hiernaast iets in.</p>';
    $('#puzzelLijstTitel').textContent = staat.puzzels.length ? `Mijn verzameling (${staat.puzzels.length})` : 'Mijn verzameling';
    if (staat.bron) {
      $('#puzzelBron').innerHTML = staat.bron.aan
        ? `Barcodes en namen komen uit <a href="https://world.openproductsfacts.org/" target="_blank" rel="noopener">Open Products Facts</a> (open data, ${esc(staat.bron.licentie)}). Foto's uit die databank nemen we niet over: je ziet je eigen foto van de doos.`
        : 'De databank met puzzelgegevens staat uit; je vult alles zelf in. Wat je invult wordt per barcode onthouden.';
    }
  }

  function vulKeuze(select, opties, eerste) {
    if (!select) return;
    const huidig = select.value;
    select.innerHTML = (eerste ? `<option value="">${esc(eerste)}</option>` : '') + opties.map((o) => `<option value="${esc(o.waarde)}">${esc(o.tekst)}</option>`).join('');
    if (huidig) select.value = huidig;
  }

  function vulDatalist(lijst, waarden) {
    if (lijst) lijst.innerHTML = waarden.map((w) => `<option value="${esc(w)}"></option>`).join('');
  }

  const KLEUR = {nieuw: '#6b7280', bezig: '#d07a1f', gedaan: '#2f7d4f', uitgeleend: '#2f6fb5'};

  function kaart(puzzel) {
    const stukken = puzzel.stukken ? `<span class="pill">${puzzel.stukken} stukken</span>` : '<span class="pill">aantal stukken onbekend</span>';
    const foto = puzzel.foto
      ? `<img class="puzzelFoto" src="${esc(puzzel.foto)}" alt="Doos van ${esc(puzzel.titel)}">`
      : '<div class="puzzelFoto puzzelFotoLeeg" aria-hidden="true">🧩</div>';
    const uitleen = puzzel.status === 'uitgeleend'
      ? `<div class="hint">Uitgeleend aan ${esc(puzzel.uitgeleend_aan)}${puzzel.uitgeleend_op ? ` sinds ${esc(puzzel.uitgeleend_op)}` : ''}</div>` : '';
    const bron = puzzel.bronPagina
      ? `<a class="puzzelBronLink" href="${esc(puzzel.bronPagina)}" target="_blank" rel="noopener">bron bekijken</a>` : '';
    return `<article class="puzzel" data-id="${puzzel.id}">
      ${foto}
      <div class="puzzelKop"><h3>${esc(puzzel.titel)}</h3><span class="puzzelStatus" style="background:${KLEUR[puzzel.status] || '#6b7280'}">${esc(puzzel.statusTekst)}</span></div>
      <div class="puzzelMeta">${puzzel.merk ? `<span>${esc(puzzel.merk)}</span>` : ''}${puzzel.jaar ? `<span>${esc(puzzel.jaar)}</span>` : ''}${puzzel.soort ? `<span>${esc(puzzel.soort)}</span>` : ''}${puzzel.aantal > 1 ? `<span>${puzzel.aantal}×</span>` : ''}</div>
      <div class="puzzelPillen">${stukken}</div>
      ${puzzel.locatie ? `<div class="hint">Staat in: ${esc(puzzel.locatie)}</div>` : ''}
      ${uitleen}
      ${puzzel.notitie ? `<p class="puzzelNotitie">${esc(puzzel.notitie)}</p>` : ''}
      <div class="puzzelActies">
        <button class="btn" type="button" data-bewerk>Bewerken</button>
        <button class="btn" type="button" data-foto>Foto kiezen</button>
        ${puzzel.status === 'gedaan' ? '' : '<button class="btn" type="button" data-gedaan>Gemaakt</button>'}
        ${puzzel.status === 'uitgeleend' ? '<button class="btn" type="button" data-terug>Terug in de kast</button>' : '<button class="btn" type="button" data-uitlenen>Uitlenen</button>'}
        ${bron}
        <button class="btn danger" type="button" data-weg>Weg</button>
      </div>
      <input type="file" accept="image/*" hidden data-foto-invoer>
    </article>`;
  }

  // ---- Zoeken op barcode ---------------------------------------------------------
  async function zoekCode(code, ververs) {
    if (!code) return;
    meld('Bezig met opzoeken…');
    try {
      const uitkomst = await api(`/api/puzzels/zoek?code=${encodeURIComponent(code)}${ververs ? '&ververs=1' : ''}`);
      if (uitkomst.inBezit && uitkomst.puzzel) {
        meld(`Deze zit al in je verzameling: ${uitkomst.puzzel.titel}.`);
        staat.bewerken = uitkomst.puzzel.id;
        vulFormulier(uitkomst.puzzel);
        return;
      }
      staat.bewerken = null;
      const voorstel = uitkomst.voorstel || {};
      $('#puzzelCode').value = uitkomst.code || code;
      $('#puzzelTitel').value = voorstel.titel || '';
      $('#puzzelMerk').value = voorstel.merk || '';
      $('#puzzelStukken').value = voorstel.stukken || '';
      $('#puzzelSoort').value = voorstel.soort || '';
      $('#puzzelTitel').focus();
      meld(uitkomst.gevonden
        ? `Gevonden: ${voorstel.titel}${voorstel.merk ? ` (${voorstel.merk})` : ''}. Controleer het aantal stukken en vul aan wat je wilt.`
        : (uitkomst.reden || 'Deze barcode is nog niet bekend; vul zelf in wat er op de doos staat. Het wordt per barcode onthouden.'));
    } catch (fout) {
      meld(fout.message, true);
    }
  }

  function vulFormulier(puzzel) {
    $('#puzzelCode').value = puzzel.code || '';
    $('#puzzelTitel').value = puzzel.titel || '';
    $('#puzzelMerk').value = puzzel.merk || '';
    $('#puzzelStukken').value = puzzel.stukken || '';
    $('#puzzelSoort').value = puzzel.soort || '';
    $('#puzzelJaar').value = puzzel.jaar || '';
    $('#puzzelFormaat').value = puzzel.formaat || '';
    $('#puzzelLocatie').value = puzzel.locatie || '';
    $('#puzzelStatus').value = puzzel.status || 'nieuw';
    $('#puzzelUitgeleend').value = puzzel.uitgeleend_aan || '';
    $('#puzzelUitgeleendVak').hidden = puzzel.status !== 'uitgeleend';
    $('#puzzelAantal').value = puzzel.aantal || 1;
    $('#puzzelNotitie').value = puzzel.notitie || '';
    $('#puzzelOpslaan').textContent = staat.bewerken ? 'Wijziging bewaren' : 'In mijn verzameling zetten';
    $('#puzzelWis').hidden = !staat.bewerken;
  }

  function leegFormulier() {
    staat.bewerken = null;
    ['#puzzelCode', '#puzzelTitel', '#puzzelMerk', '#puzzelStukken', '#puzzelSoort', '#puzzelJaar', '#puzzelFormaat', '#puzzelLocatie', '#puzzelUitgeleend', '#puzzelNotitie'].forEach((id) => { $(id).value = ''; });
    $('#puzzelAantal').value = 1;
    $('#puzzelStatus').value = 'nieuw';
    $('#puzzelUitgeleendVak').hidden = true;
    $('#puzzelOpslaan').textContent = 'In mijn verzameling zetten';
    $('#puzzelWis').hidden = true;
    meld('');
  }

  function gegevensUitFormulier() {
    return {
      code: $('#puzzelCode').value.trim(),
      titel: $('#puzzelTitel').value.trim(),
      merk: $('#puzzelMerk').value.trim(),
      stukken: $('#puzzelStukken').value.trim(),
      soort: $('#puzzelSoort').value.trim(),
      jaar: $('#puzzelJaar').value.trim(),
      formaat: $('#puzzelFormaat').value.trim(),
      locatie: $('#puzzelLocatie').value.trim(),
      status: $('#puzzelStatus').value,
      uitgeleendAan: $('#puzzelUitgeleend').value.trim(),
      aantal: $('#puzzelAantal').value.trim(),
      notitie: $('#puzzelNotitie').value.trim(),
    };
  }

  // ---- Camera ---------------------------------------------------------------------
  async function scanCamera() {
    const video = $('#puzzelCamera');
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
        video.hidden = true;
        return;
      }
      const detector = new BarcodeDetector({formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf']});
      staat.scan = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
      video.srcObject = staat.scan;
      video.hidden = false;
      await video.play();
      meld('Houd de barcode voor de camera…');
      const helper = window.BarcodeScan;
      let vorige = '';
      let telling = 0;
      const kijk = async () => {
        if (!staat.scan) return;
        try {
          const uitslagen = await detector.detect(video);
          const lezing = helper && typeof helper.volgendeLezing === 'function'
            ? helper.volgendeLezing(vorige, telling, uitslagen, 3)
            : {code: uitslagen.length ? String(uitslagen[0].rawValue) : '', count: 0, accepted: Boolean(uitslagen.length)};
          vorige = lezing.code || '';
          telling = lezing.count || 0;
          if (lezing.accepted && lezing.code) {
            staat.scan.getTracks().forEach((t) => t.stop());
            staat.scan = null;
            video.hidden = true;
            $('#puzzelCode').value = lezing.code;
            await zoekCode(lezing.code, false);
            return;
          }
        } catch { /* volgende frame */ }
        requestAnimationFrame(() => setTimeout(kijk, 120));
      };
      kijk();
    } catch (fout) {
      meld('De camera kon niet starten; typ de barcode in.', true);
    }
  }

  // ---- Foto bij een puzzel -------------------------------------------------------
  async function bewaarFoto(id, bestand) {
    if (bestand.size > 4_000_000) {
      meld('Kies een foto van maximaal 4 MB.', true);
      return;
    }
    const lezer = new FileReader();
    lezer.onload = async () => {
      try {
        await api(`/api/puzzels/${id}/foto`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({afbeelding: lezer.result}),
        });
        meld('Foto bewaard.');
        await laad();
      } catch (fout) {
        meld(fout.message, true);
      }
    };
    lezer.readAsDataURL(bestand);
  }

  // ---- Koppelen aan de pagina ----------------------------------------------------
  function koppel() {
    $('#puzzelScan').addEventListener('click', scanCamera);
    $('#puzzelCode').addEventListener('change', () => zoekCode($('#puzzelCode').value.trim(), false));
    $('#puzzelOpnieuw').addEventListener('click', () => zoekCode($('#puzzelCode').value.trim(), true));
    $('#puzzelZoek').addEventListener('input', () => { clearTimeout(staat.tik); staat.tik = setTimeout(() => laad().catch((f) => meld(f.message, true)), 250); });
    ['#puzzelMerkFilter', '#puzzelStukkenFilter', '#puzzelStatusFilter', '#puzzelLocatieFilter'].forEach((id) => {
      $(id).addEventListener('change', () => laad().catch((f) => meld(f.message, true)));
    });
    $('#puzzelWisFilters').addEventListener('click', () => {
      $('#puzzelZoek').value = '';
      ['#puzzelMerkFilter', '#puzzelStukkenFilter', '#puzzelStatusFilter', '#puzzelLocatieFilter'].forEach((id) => { $(id).value = ''; });
      laad().catch((f) => meld(f.message, true));
    });
    $('#puzzelStatus').addEventListener('change', () => {
      $('#puzzelUitgeleendVak').hidden = $('#puzzelStatus').value !== 'uitgeleend';
    });
    $('#puzzelStukkenKnoppen').addEventListener('click', (gebeurtenis) => {
      const knop = gebeurtenis.target.closest('[data-stukken]');
      if (!knop) return;
      $('#puzzelStukken').value = knop.dataset.stukken;
    });
    $('#puzzelWis').addEventListener('click', leegFormulier);
    $('#puzzelForm').addEventListener('submit', async (gebeurtenis) => {
      gebeurtenis.preventDefault();
      try {
        if (staat.bewerken) {
          await api(`/api/puzzels/${staat.bewerken}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(gegevensUitFormulier())});
          meld('Wijziging bewaard.');
        } else {
          const uitkomst = await api('/api/puzzels', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(gegevensUitFormulier())});
          meld(`${uitkomst.puzzel.titel} staat in je verzameling.`);
        }
        leegFormulier();
        await laad();
      } catch (fout) {
        meld(fout.message, true);
      }
    });
    $('#puzzelGrid').addEventListener('click', async (gebeurtenis) => {
      const kaartVak = gebeurtenis.target.closest('[data-id]');
      if (!kaartVak) return;
      const id = Number(kaartVak.dataset.id);
      const puzzel = staat.puzzels.find((p) => p.id === id);
      try {
        if (gebeurtenis.target.closest('[data-bewerk]')) {
          staat.bewerken = id;
          vulFormulier(puzzel);
          meld(`Je bewerkt ${puzzel.titel}.`);
          $('#puzzelTitel').scrollIntoView({block: 'center'});
          return;
        }
        if (gebeurtenis.target.closest('[data-foto]')) { kaartVak.querySelector('[data-foto-invoer]').click(); return; }
        if (gebeurtenis.target.closest('[data-gedaan]')) { await api(`/api/puzzels/${id}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify({status: 'gedaan'})}); meld('Afgevinkt als gemaakt.'); await laad(); return; }
        if (gebeurtenis.target.closest('[data-uitlenen]')) {
          const naam = prompt('Aan wie leen je deze puzzel uit?', puzzel.uitgeleend_aan || '');
          if (naam == null) return;
          await api(`/api/puzzels/${id}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify({status: 'uitgeleend', uitgeleendAan: naam, uitgeleendOp: new Date().toISOString().slice(0, 10)})});
          meld(`Uitgeleend aan ${naam}.`);
          await laad();
          return;
        }
        if (gebeurtenis.target.closest('[data-terug]')) { await api(`/api/puzzels/${id}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify({status: 'nieuw'})}); meld('Weer in de kast.'); await laad(); return; }
        if (gebeurtenis.target.closest('[data-weg]')) {
          if (!confirm(`${puzzel.titel} uit je verzameling halen?`)) return;
          await api(`/api/puzzels/${id}`, {method: 'DELETE'});
          meld('Uit de verzameling gehaald.');
          await laad();
        }
      } catch (fout) {
        meld(fout.message, true);
      }
    });
    $('#puzzelGrid').addEventListener('change', (gebeurtenis) => {
      const invoer = gebeurtenis.target.closest('[data-foto-invoer]');
      if (!invoer || !invoer.files || !invoer.files[0]) return;
      const kaartVak = invoer.closest('[data-id]');
      bewaarFoto(Number(kaartVak.dataset.id), invoer.files[0]);
    });
  }

  window.PuzzelsPagina = {
    start() {
      if (staat.gestart) return;
      staat.gestart = true;
      koppel();
    },
    toon() {
      this.start();
      return laad().catch((fout) => meld(fout.message, true));
    },
  };
})();
