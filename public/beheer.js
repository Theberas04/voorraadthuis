/* Beheer: wachtwoord instellen of inloggen, versie bekijken, controleren op een nieuwe
   versie en de app bijwerken. De app schrijft alleen een vlagbestand; het echte werk
   doet het bijwerkscript van de dienst (zie deploy/in-app-update.sh). */
(function () {
  const $ = (kies) => document.querySelector(kies);
  const esc = (tekst) => String(tekst == null ? '' : tekst).replace(/[&<>"']/g, (t) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[t]));
  const staat = {gegevens: null, tik: null, kijk: null, gestart: false};

  async function api(pad, opties = {}) {
    const antwoord = await fetch(pad, {
      ...opties,
      headers: {...(opties.headers || {}), 'x-voorraadthuis': 'beheer'},
    });
    const gegevens = await antwoord.json().catch(() => ({}));
    if (!antwoord.ok) throw Error(gegevens.error || 'Er ging iets mis.');
    return gegevens;
  }

  const meld = (tekst, fout) => {
    const vak = $('#beheerNotice');
    vak.textContent = tekst || '';
    vak.className = fout ? 'notice fout' : 'notice';
  };

  function datumMooi(waarde) {
    if (!waarde) return '';
    const d = new Date(waarde);
    if (Number.isNaN(d.getTime())) return waarde;
    return d.toLocaleString('nl-NL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  }

  function toon() {
    const gegevens = staat.gegevens || {};
    $('#beheerInstellen').hidden = Boolean(gegevens.ingesteld);
    $('#beheerInloggen').hidden = !gegevens.ingesteld || Boolean(gegevens.ingelogd);
    $('#beheerPaneel').hidden = !gegevens.ingelogd;
    $('#beheerTitel').textContent = gegevens.ingelogd ? 'Beheer' : (gegevens.ingesteld ? 'Beheer — inloggen' : 'Beheer — wachtwoord instellen');
    if (!gegevens.ingelogd) return;

    const huidig = gegevens.huidig || {};
    const nieuw = gegevens.beschikbaar || {};
    $('#beheerNu').innerHTML = huidig.sha
      ? `<code>${esc(String(huidig.sha).slice(0, 7))}</code> · ${esc(datumMooi(huidig.datum))}${huidig.onderwerp ? ` · ${esc(huidig.onderwerp)}` : ''}`
      : '<span class="muted">Deze installatie heeft nog geen versienummer vastgelegd; hij werkt zich bij zodra je hieronder op Bijwerken drukt.</span>';

    const vak = $('#beheerBeschikbaar');
    if (!nieuw.gelukt) vak.innerHTML = `<span class="muted">${esc(nieuw.reden || 'Nog niet gecontroleerd.')}</span>`;
    else if (gegevens.nieuw) vak.innerHTML = `<strong>Nieuwe versie klaar:</strong> <code>${esc(nieuw.kort)}</code> · ${esc(datumMooi(nieuw.datum))} · ${esc(nieuw.onderwerp)}`;
    else vak.innerHTML = `<span class="goed">Je loopt bij (nieuwste is <code>${esc(nieuw.kort)}</code>).</span>`;

    $('#beheerUpdate').disabled = !gegevens.nieuw || gegevens.updateBezig;
    $('#beheerUpdate').textContent = gegevens.nieuw
      ? `Bijwerken naar ${String(nieuw.kort || '').slice(0, 7)}`
      : 'Bijwerken';
    $('#beheerBezig').hidden = !gegevens.updateBezig;
    $('#beheerSysteem').hidden = Boolean(gegevens.kanBijwerken);
    $('#beheerLog').textContent = (gegevens.log || []).join('\n');
    $('#beheerLogVak').hidden = !(gegevens.log || []).length;
  }

  async function laad(ververs) {
    try {
      staat.gegevens = await api(`/api/beheer/status${ververs ? '?ververs=1' : ''}`);
      toon();
      if (staat.gegevens.updateBezig) blijfKijken();
    } catch (fout) {
      meld(fout.message, true);
    }
  }

  // Tijdens het bijwerken herstart de app; de pagina blijft het dus gewoon opnieuw
  // proberen tot hij er weer is, en laat dan het resultaat uit het logboek zien.
  function blijfKijken() {
    clearTimeout(staat.kijk);
    staat.kijk = setTimeout(async () => {
      try { await laad(false); meld('De app is weer bereikbaar.'); }
      catch { blijfKijken(); }
      if (staat.gegevens && staat.gegevens.updateBezig) blijfKijken();
    }, 4000);
  }

  function koppel() {
    $('#beheerInstelForm').addEventListener('submit', async (gebeurtenis) => {
      gebeurtenis.preventDefault();
      const een = $('#beheerNieuwWachtwoord').value;
      const twee = $('#beheerNieuwWachtwoord2').value;
      if (een !== twee) { meld('De twee wachtwoorden zijn niet gelijk.', true); return; }
      try {
        await api('/api/beheer/wachtwoord', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({wachtwoord: een})});
        $('#beheerInstelForm').reset();
        meld('Wachtwoord ingesteld; je bent meteen ingelogd.');
        await laad(true);
      } catch (fout) { meld(fout.message, true); }
    });
    $('#beheerInlogForm').addEventListener('submit', async (gebeurtenis) => {
      gebeurtenis.preventDefault();
      try {
        await api('/api/beheer/inloggen', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({wachtwoord: $('#beheerWachtwoord').value})});
        $('#beheerInlogForm').reset();
        meld('Je bent ingelogd.');
        await laad(true);
      } catch (fout) { meld(fout.message, true); }
    });
    $('#beheerControleer').addEventListener('click', async () => {
      meld('Bezig met controleren…');
      try { await laad(true); meld('Gecontroleerd bij GitHub.'); } catch (fout) { meld(fout.message, true); }
    });
    $('#beheerUpdate').addEventListener('click', async () => {
      const nieuw = (staat.gegevens || {}).beschikbaar || {};
      if (!confirm(`De app bijwerken naar ${String(nieuw.kort || 'de nieuwste versie').slice(0, 7)}?\n\nDe app herstart daarbij en is even niet bereikbaar. Gaat er iets mis, dan zet het bijwerkscript de vorige versie terug.`)) return;
      meld('Bijwerken aangevraagd…');
      try {
        await api('/api/beheer/update', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({sha: nieuw.sha || ''})});
        meld('De app werkt zich nu bij en herstart zo. Deze pagina blijft kijken en laat het resultaat zien.');
        // Meteen laten zien dat het loopt; de controle op de achtergrond bevestigt het.
        staat.gegevens.updateBezig = true;
        toon();
        blijfKijken();
        await laad(false);
      } catch (fout) { meld(fout.message, true); }
    });
    $('#beheerUitloggen').addEventListener('click', async () => {
      await api('/api/beheer/uitloggen', {method: 'POST'});
      meld('Je bent uitgelogd.');
      await laad(false);
    });
    $('#beheerWijzigForm').addEventListener('submit', async (gebeurtenis) => {
      gebeurtenis.preventDefault();
      const een = $('#beheerWijzigNieuw').value;
      const twee = $('#beheerWijzigNieuw2').value;
      if (een !== twee) { meld('De twee nieuwe wachtwoorden zijn niet gelijk.', true); return; }
      try {
        await api('/api/beheer/wachtwoord', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({oudWachtwoord: $('#beheerWijzigOud').value, wachtwoord: een})});
        $('#beheerWijzigForm').reset();
        meld('Wachtwoord gewijzigd.');
      } catch (fout) { meld(fout.message, true); }
    });
  }

  window.BeheerPagina = {
    toon() {
      if (!staat.gestart) { staat.gestart = true; koppel(); }
      return laad(false);
    },
  };
})();
