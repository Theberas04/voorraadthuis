// Agenda-bestand (.ics) voor de maaltijd- en werkplanning.
//
// Waarom een eigen bestand in plaats van een module van buitenaf: het formaat is
// klein en streng (RFC 5545), en zo kunnen we precies doen wat in deze app nodig
// is: de diensten als afspraken met tijd, het geplande recept als hele-dag-item, en
// de kleur van een dienst meegeven aan agenda's die dat ondersteunen.
//
// Twee dingen zijn hier sneller fout dan je denkt en worden daarom apart getest:
// het vouwen van lange regels op 75 tekens (anders kapt een agenda de tekst af) en
// het omgaan met een dienst die over middernacht heen loopt (22:00–06:00 hoort de
// volgende dag te eindigen).
const REGEL_EINDE = '\r\n';
const KALENDER_NAAM = 'VoorraadThuis';
const TIJDZONE = 'Europe/Amsterdam';

// Dezelfde kleuren als in de app (KLEUR_HEX in public/index.html). Agenda's die
// COLOR ondersteunen (o.a. Apple en Thunderbird) laten de dienst in deze kleur zien.
const KLEUR_HEX = {groen:'#2f7d4f',blauw:'#2f6fb5',paars:'#7b4fa8',oranje:'#d07a1f',rood:'#c0392b',teal:'#1f8a8a',geel:'#c9a227',grijs:'#6b7280'};

const DIENST_TIJDZONE =
  `BEGIN:VTIMEZONE${REGEL_EINDE}` +
  `TZID:${TIJDZONE}${REGEL_EINDE}` +
  `X-LIC-LOCATION:${TIJDZONE}${REGEL_EINDE}` +
  `BEGIN:DAYLIGHT${REGEL_EINDE}` +
  `TZOFFSETFROM:+0100${REGEL_EINDE}` +
  `TZOFFSETTO:+0200${REGEL_EINDE}` +
  `TZNAME:CEST${REGEL_EINDE}` +
  `DTSTART:19700329T020000${REGEL_EINDE}` +
  `RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU${REGEL_EINDE}` +
  `END:DAYLIGHT${REGEL_EINDE}` +
  `BEGIN:STANDARD${REGEL_EINDE}` +
  `TZOFFSETFROM:+0200${REGEL_EINDE}` +
  `TZOFFSETTO:+0100${REGEL_EINDE}` +
  `TZNAME:CET${REGEL_EINDE}` +
  `DTSTART:19701025T030000${REGEL_EINDE}` +
  `RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU${REGEL_EINDE}` +
  `END:STANDARD${REGEL_EINDE}` +
  `END:VTIMEZONE`;

function tekst(waarde){
  return String(waarde == null ? '' : waarde)
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// RFC 5545: regels van maximaal 75 octetten; langere regels lopen door op de
// volgende regel met een spatie ervoor. We tellen in bytes, niet in tekens, want
// 'ë' en 'é' kosten er twee.
function vouw(regel){
  const uit = [];
  let deel = '';
  let lengte = 0;
  // De eerste regel mag 75 octetten zijn; elke vervolgregel begint met een spatie
  // die ook meetelt, dus daar past 74 octetten inhoud op.
  let ruimte = 75;
  for (const teken of String(regel)) {
    const grootte = Buffer.byteLength(teken, 'utf8');
    if (lengte + grootte > ruimte) { uit.push(deel); deel = ''; lengte = 0; ruimte = 74; }
    deel += teken; lengte += grootte;
  }
  uit.push(deel);
  return uit.join(`${REGEL_EINDE} `);
}

function datumDelen(datum){
  return String(datum || '').slice(0, 10);
}

function isDatum(waarde){
  return /^\d{4}-\d{2}-\d{2}$/.test(waarde);
}

function volgendeDag(datum){
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function datumKort(datum){
  return datum.replace(/-/g, '');
}

function klokDelen(tijd){
  const m = /^(\d{2}):(\d{2})$/.exec(String(tijd || ''));
  return m ? {uur: m[1], minuut: m[2]} : null;
}

function alsLokaleTijd(datum, tijd){
  const klok = klokDelen(tijd);
  return klok ? `${datumKort(datum)}T${klok.uur}${klok.minuut}00` : '';
}

function nuUtc(nu){
  const d = nu instanceof Date ? nu : new Date();
  return `${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

// SQLite bewaart 'YYYY-MM-DD HH:MM:SS' in UTC; het agenda-formaat wil
// 'YYYYMMDDTHHMMSSZ'.
function alsUtc(stempel){
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(stempel || ''));
  return m ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z` : '';
}

// Hoe vaak een agenda-app dit adres opnieuw mag ophalen. Zonder deze regel
// verversen veel apps een abonnement pas na dagen; met een uur zie je een
// wijziging in de app binnen een uur terug in je agenda.
const VERVERS_ELK_UUR = 'PT1H';

function dienstenVanDag(plan){
  const diensten = Array.isArray(plan.shifts) && plan.shifts.length
    ? plan.shifts.map(s => ({name: s.name || '', startTime: s.startTime || '', endTime: s.endTime || '', notes: s.notes || '', color: s.color || ''}))
    : [];
  // Oude planningen (van voor de losse diensten) bewaren één dienst in de
  // werkvelden. Die nemen we mee zodat niets uit de agenda verdwijnt.
  if (!diensten.length && (plan.work_start || plan.work_end || plan.work_notes)) {
    diensten.push({name: plan.work_notes || 'Dienst', startTime: plan.work_start || '', endTime: plan.work_end || '', notes: '', color: ''});
  }
  return diensten.filter(d => d.startTime || d.endTime || d.name);
}

// Bouwt het volledige agenda-bestand op. `plannen` zijn de rijen zoals de
// plannertabel ze teruggeeft (met `shifts`), `receptNaam` vertaalt een recept-id
// naar de titel, en `nu` maakt het bestand testbaar.
function maakAgenda(plannen, opties = {}){
  const kalenderNaam = opties.kalenderNaam || KALENDER_NAAM;
  const receptNaam = typeof opties.receptNaam === 'function' ? opties.receptNaam : () => '';
  const stempel = nuUtc(opties.nu);
  const regels = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//VoorraadThuis//Agenda//NL`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${tekst(kalenderNaam)}`,
    `X-WR-TIMEZONE:${TIJDZONE}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${VERVERS_ELK_UUR}`,
    `X-PUBLISHED-TTL:${VERVERS_ELK_UUR}`,
  ];
  regels.push(...DIENST_TIJDZONE.split(REGEL_EINDE));

  const dagen = (Array.isArray(plannen) ? plannen : [])
    .filter(p => isDatum(datumDelen(p && p.plan_date)))
    .sort((a, b) => String(a.plan_date).localeCompare(String(b.plan_date)));

  for (const plan of dagen) {
    const datum = datumDelen(plan.plan_date);
    const naam = receptNaam(plan.recipe_id);
    // Een hoger revisienummer betekent voor de agenda-app: dit is een nieuwe
    // versie van hetzelfde item. Dat is wat een wijziging doorlaat.
    const reeks = Math.max(1, Number(plan.rev) || 1);
    const gewijzigd = alsUtc(plan.gewijzigd);
    const versie = [`SEQUENCE:${reeks}`, ...(gewijzigd ? [`LAST-MODIFIED:${gewijzigd}`] : [])];
    if (naam || plan.cuisine) {
      const titel = naam ? `Avondeten: ${naam}` : `Maaltijd: ${plan.cuisine}`;
      const omschrijving = [plan.cuisine ? `Landkeuken: ${plan.cuisine}` : '', plan.porties ? `Porties: ${plan.porties}` : ''].filter(Boolean).join(' · ');
      regels.push(
        'BEGIN:VEVENT',
        `UID:voorraadthuis-${datum}-maaltijd@voorraadthuis`,
        `DTSTAMP:${stempel}`,
        ...versie,
        `SUMMARY:${tekst(titel)}`,
        `DTSTART;VALUE=DATE:${datumKort(datum)}`,
        `DTEND;VALUE=DATE:${datumKort(volgendeDag(datum))}`,
        ...(omschrijving ? [`DESCRIPTION:${tekst(omschrijving)}`] : []),
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }

    dienstenVanDag(plan).forEach((dienst, i) => {
      const start = klokDelen(dienst.startTime) && klokDelen(dienst.endTime)
        ? {
            van: alsLokaleTijd(datum, dienst.startTime),
            // Een nachtdienst (22:00–06:00) eindigt de volgende dag.
            tot: alsLokaleTijd(dienst.endTime <= dienst.startTime ? volgendeDag(datum) : datum, dienst.endTime),
          }
        : null;
      const titel = dienst.name ? `Dienst: ${dienst.name}` : 'Werkdienst';
      const omschrijving = [
        dienst.notes || '',
        dienst.startTime && dienst.endTime && !start ? `Tijd: ${dienst.startTime}–${dienst.endTime}` : '',
      ].filter(Boolean).join(' · ');
      regels.push(
        'BEGIN:VEVENT',
        `UID:voorraadthuis-${datum}-dienst-${i}-${String(dienst.startTime).replace(/:/g, '')}-${String(dienst.endTime).replace(/:/g, '')}@voorraadthuis`,
        `DTSTAMP:${stempel}`,
        ...versie,
        `SUMMARY:${tekst(titel)}`,
        ...(start
          ? [`DTSTART;TZID=${TIJDZONE}:${start.van}`, `DTEND;TZID=${TIJDZONE}:${start.tot}`]
          : [`DTSTART;VALUE=DATE:${datumKort(datum)}`, `DTEND;VALUE=DATE:${datumKort(volgendeDag(datum))}`]),
        ...(omschrijving ? [`DESCRIPTION:${tekst(omschrijving)}`] : []),
        ...(KLEUR_HEX[dienst.color] ? [`COLOR:${KLEUR_HEX[dienst.color]}`] : []),
        'END:VEVENT',
      );
    });
  }

  regels.push('END:VCALENDAR');
  return regels.map(vouw).join(REGEL_EINDE) + REGEL_EINDE;
}

function bestandsnaam(maand){
  return isDatum(`${maand}-01`) ? `voorraadthuis-agenda-${maand}.ics` : 'voorraadthuis-agenda.ics';
}

module.exports = {maakAgenda, bestandsnaam, tekst, vouw, TIJDZONE, KLEUR_HEX};
