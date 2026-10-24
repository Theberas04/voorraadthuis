'use strict';
// Profielen en SMS voor VoorraadThuis.
//
// Een profiel is een huisgenoot met contactgegevens. Aan een profiel kan een
// telefoonnummer hangen; de knop "Verstuur via SMS" op de boodschappenlijst
// stuurt de lijst naar dat nummer.
//
// Er zijn vier kanalen:
//   link    - de app opent de berichten-app van de telefoon met het nummer en de
//             tekst al ingevuld (werkt zonder instellingen, verstuurt zelf niets)
//   webhook - de server POST {to,from,body} naar een door de gebruiker opgegeven
//             URL (bijv. Home Assistant, een eigen gateway of een SMS-dienst)
//   cheapconnect - de server verstuurt via de SMS-API van CheapConnect
//             (Nederlandse aanbieder, eigen API-sleutel uit het klantenpaneel)
//   twilio  - de server verstuurt via de Twilio API met eigen inloggegevens
//
// Inloggegevens worden door de gebruiker in de app ingevuld, lokaal in de
// database bewaard en nooit teruggegeven aan de pagina of naar de logboeken.
const { randomUUID } = require('node:crypto');

const MAX_NAME = 80;
const MAX_NOTE = 300;
const MAX_PHONE = 24;
const DEFAULT_COUNTRY = '+31';
const PROVIDERS = ['link', 'webhook', 'cheapconnect', 'twilio'];
const SETTING_KEYS = ['sms.provider', 'sms.from', 'sms.sender', 'sms.webhookUrl', 'sms.webhookToken', 'sms.cheapconnectKey', 'sms.twilioSid', 'sms.twilioToken', 'sms.twilioFrom'];
// De SMS-API van CheapConnect; overschrijfbaar zodat de tests tegen een eigen
// ontvanger kunnen draaien in plaats van tegen de echte dienst.
const CHEAPCONNECT_URL = 'https://account.cheapconnect.net/API/v1/sms/SendSMS';
// Geheimen komen nooit de deur uit: de pagina ziet alleen een vaste redactie-markering.
const SECRET_KEYS = ['sms.webhookToken', 'sms.cheapconnectKey', 'sms.twilioSid', 'sms.twilioToken'];

function cleanString(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Telefoonnummers worden opgeslagen in internationale notatie, zodat een sms
// altijd naar hetzelfde nummer gaat: 06 12345678 -> +31612345678.
function normalizePhone(value) {
  const raw = cleanString(value, 40);
  if (!raw) return '';
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) {
    if (/^0\d{8,9}$/.test(digits)) digits = `${DEFAULT_COUNTRY}${digits.slice(1)}`;
    else if (/^\d{9}$/.test(digits)) digits = `${DEFAULT_COUNTRY}${digits}`;
    else digits = `+${digits}`;
  }
  digits = `+${digits.slice(1).replace(/\D/g, '')}`;
  if (!/^\+[1-9]\d{6,14}$/.test(digits)) throw Error('Vul een geldig telefoonnummer in, bijvoorbeeld 06 12345678 of +31612345678.');
  if (digits.length > MAX_PHONE) throw Error('Dit telefoonnummer is te lang.');
  return digits;
}

// Leesbaar Nederlands nummer voor in de app: +31 6 12345678.
function prettyPhone(value) {
  const nummer = String(value || '');
  if (/^\+31\d{9}$/.test(nummer)) {
    const rest = nummer.slice(3);
    const mobiel = rest.startsWith('6');
    return mobiel ? `+31 6 ${rest.slice(1, 5)} ${rest.slice(5)}` : `+31 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
  }
  return nummer;
}

function buildShoppingMessage(items, options = {}) {
  const rows = (items || []).map(item => {
    const naam = cleanString(item.name, 400);
    if (!naam) return null;
    if (item.unit === 'niet vermeld') return `- ${naam}`;
    if (item.unit === 'bronregel') return `- ${naam}`;
    const aantal = Number(item.quantity);
    const hoeveelheid = Number.isFinite(aantal) ? `${aantal % 1 === 0 ? aantal : String(aantal).replace('.', ',')} ${item.unit || 'stuks'}` : String(item.unit || '');
    return `- ${naam} (${hoeveelheid})`;
  }).filter(Boolean);
  const kop = cleanString(options.sender, 40) || 'Boodschappenlijst';
  const profiel = cleanString(options.profileName, 40);
  const regels = [profiel ? `${kop} voor ${profiel}:` : `${kop}:`, ...rows];
  const extra = cleanString(options.notes, 200);
  if (extra) regels.push('', extra);
  return regels.join('\n');
}

function createProfiles({ db, fetchImpl = globalThis.fetch, cheapconnectUrl = CHEAPCONNECT_URL } = {}) {
  if (!db) throw new TypeError('Een database is verplicht voor de profielen.');
  db.exec(`CREATE TABLE IF NOT EXISTS profiles(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sms_recipient INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sms_log(
    id INTEGER PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recipient TEXT NOT NULL,
    profile_id INTEGER,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT ''
  )`);

  const normalizeRow = row => row && { ...row, smsRecipient: Boolean(row.sms_recipient), phonePretty: prettyPhone(row.phone) };
  const selectProfile = 'SELECT id,name,phone,email,role,notes,sms_recipient,sms_recipient AS smsRecipient FROM profiles';
  const listProfiles = () => db.prepare(`${selectProfile} ORDER BY sms_recipient DESC, name COLLATE NOCASE, id`).all().map(normalizeRow);
  const getProfile = id => normalizeRow(db.prepare(`${selectProfile} WHERE id=?`).get(Number(id)));

  function readInput(input = {}, bestaand = {}) {
    const name = cleanString(input.name ?? bestaand.name, MAX_NAME);
    if (!name) throw Error('Vul een naam in voor dit profiel.');
    const phone = normalizePhone(input.phone ?? bestaand.phone ?? '');
    const email = cleanString(input.email ?? bestaand.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Dit e-mailadres klopt niet.');
    const role = cleanString(input.role ?? bestaand.role, MAX_NAME);
    const notes = String(input.notes ?? bestaand.notes ?? '').trim().slice(0, MAX_NOTE);
    const smsRecipient = input.smsRecipient === undefined ? Boolean(bestaand.sms_recipient) : Boolean(input.smsRecipient);
    if (smsRecipient && !phone) throw Error('Vul eerst een telefoonnummer in voordat dit profiel de boodschappenlijst per sms ontvangt.');
    return { name, phone, email, role, notes, smsRecipient };
  }

  function createProfile(input) {
    const velden = readInput(input);
    const result = db.prepare('INSERT INTO profiles(name,phone,email,role,notes,sms_recipient) VALUES(?,?,?,?,?,?)')
      .run(velden.name, velden.phone, velden.email, velden.role, velden.notes, velden.smsRecipient ? 1 : 0);
    if (velden.smsRecipient) markOtherRecipients(Number(result.lastInsertRowid));
    return getProfile(result.lastInsertRowid);
  }

  function updateProfile(id, input) {
    const bestaand = db.prepare('SELECT * FROM profiles WHERE id=?').get(Number(id));
    if (!bestaand) return null;
    const velden = readInput(input, bestaand);
    db.prepare('UPDATE profiles SET name=?,phone=?,email=?,role=?,notes=?,sms_recipient=? WHERE id=?')
      .run(velden.name, velden.phone, velden.email, velden.role, velden.notes, velden.smsRecipient ? 1 : 0, Number(id));
    if (velden.smsRecipient) markOtherRecipients(Number(id));
    return getProfile(id);
  }

  // Eén standaardontvanger houdt de knop voorspelbaar; andere profielen blijven
  // gewoon kiesbaar in de keuzelijst op de boodschappenlijst.
  function markOtherRecipients(id) {
    db.prepare('UPDATE profiles SET sms_recipient=0 WHERE id<>?').run(Number(id));
  }

  function deleteProfile(id) {
    const result = db.prepare('DELETE FROM profiles WHERE id=?').run(Number(id));
    return Boolean(result.changes);
  }

  function saveSetting(key, value) {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value ?? ''));
  }
  const readSetting = key => (db.prepare('SELECT value FROM settings WHERE key=?').get(key) || {}).value || '';

  function maskSecret(value) {
    return String(value || '') ? '[REDACTED]' : '';
  }

  function getSmsSettings() {
    const provider = PROVIDERS.includes(readSetting('sms.provider')) ? readSetting('sms.provider') : 'link';
    // canSend is een ja/nee-vlag voor de knop; providerHint zegt wat er nog mist.
    const reden = canSend(provider);
    return {
      provider,
      sender: readSetting('sms.sender'),
      from: readSetting('sms.from'),
      webhookUrl: readSetting('sms.webhookUrl'),
      webhookTokenSet: Boolean(readSetting('sms.webhookToken')),
      webhookTokenMask: maskSecret(readSetting('sms.webhookToken')),
      cheapconnectKeySet: Boolean(readSetting('sms.cheapconnectKey')),
      cheapconnectKeyMask: maskSecret(readSetting('sms.cheapconnectKey')),
      twilioSidSet: Boolean(readSetting('sms.twilioSid')),
      twilioSidMask: maskSecret(readSetting('sms.twilioSid')),
      twilioTokenSet: Boolean(readSetting('sms.twilioToken')),
      twilioFrom: readSetting('sms.twilioFrom'),
      canSend: provider === 'link' || reden === '',
      providerHint: reden,
      providers: [
        { id: 'link', name: 'Berichten-app op dit apparaat', hint: 'De knop opent je berichten-app met het nummer en de lijst ingevuld. Werkt direct, zonder instellingen.' },
        { id: 'webhook', name: 'Eigen gateway of webhook', hint: 'De server stuurt {to, from, body} als JSON naar jouw URL. Werkt met onder andere Home Assistant of een eigen SMS-dienst.' },
        { id: 'cheapconnect', name: 'CheapConnect', hint: 'Vul je API-sleutel uit het CheapConnect-paneel in en een afzender (je eigen nummer of maximaal 11 letters). Elke sms kost ongeveer 7 cent.' },
        { id: 'twilio', name: 'Twilio', hint: 'Vul je Account SID, Auth Token en Twilio-nummer in; de app verstuurt de sms zelf.' },
      ],
    };
  }

  // Waarom een kanaal (nog) niet kan versturen; lege tekst betekent: kan versturen.
  function canSend(provider) {
    if (provider === 'link') return '';
    if (provider === 'webhook') return readSetting('sms.webhookUrl') ? '' : 'Vul eerst de webhook-URL in.';
    if (provider === 'twilio') {
      if (!readSetting('sms.twilioSid') || !readSetting('sms.twilioToken')) return 'Vul eerst je Twilio Account SID en Auth Token in.';
      if (!readSetting('sms.twilioFrom')) return 'Vul eerst het Twilio-afzendernummer in.';
      return '';
    }
    if (provider === 'cheapconnect') {
      if (!readSetting('sms.cheapconnectKey')) return 'Vul eerst je CheapConnect API-sleutel in (aan te maken in het klantenpaneel onder API).';
      if (!readSetting('sms.from')) return 'Vul eerst een afzender in: je eigen nummer of maximaal 11 letters.';
      return '';
    }
    return 'Onbekend sms-kanaal.';
  }

  function saveSmsSettings(input = {}) {
    const provider = String(input.provider || '').trim();
    if (!PROVIDERS.includes(provider)) throw Error('Kies een geldig sms-kanaal.');
    saveSetting('sms.provider', provider);
    if (input.sender !== undefined) saveSetting('sms.sender', cleanString(input.sender, 40));
    if (input.from !== undefined) {
      const afzender = cleanString(input.from, 40);
      // Bij CheapConnect mag een afzender in tekst maximaal 11 tekens hebben;
      // andere kanalen accepteren een langere naam.
      if (provider === 'cheapconnect' && afzender && !/^\+?\d[\d\s()-]*$/.test(afzender) && afzender.replace(/\s+/g, '').length > 11) {
        throw Error('Een afzender in tekst mag maximaal 11 tekens hebben (of vul een telefoonnummer in).');
      }
      saveSetting('sms.from', afzender);
    }
    if (input.webhookUrl !== undefined) {
      const url = cleanString(input.webhookUrl, 300);
      if (url && !/^https?:\/\/\S+$/i.test(url)) throw Error('De webhook-URL moet met http:// of https:// beginnen.');
      saveSetting('sms.webhookUrl', url);
    }
    // Een leeg tekstveld betekent "laat staan"; met 'clear:true' wis je een geheim.
    for (const [veld, sleutel] of [['webhookToken', 'sms.webhookToken'], ['cheapconnectKey', 'sms.cheapconnectKey'], ['twilioSid', 'sms.twilioSid'], ['twilioToken', 'sms.twilioToken']]) {
      if (input[veld] !== undefined && String(input[veld]).trim() !== '') saveSetting(sleutel, String(input[veld]).trim().slice(0, 200));
    }
    if (Array.isArray(input.clear)) {
      for (const sleutel of input.clear.map(String).filter(key => SETTING_KEYS.includes(key) && SECRET_KEYS.includes(key))) saveSetting(sleutel, '');
    }
    if (input.twilioFrom !== undefined) saveSetting('sms.twilioFrom', cleanString(input.twilioFrom, 40));
    // Een kanaal mag gekozen worden voordat het compleet is: de app toont wat er
    // nog mist via providerHint/canSend en pas bij verzenden volgt een foutmelding.
    return getSmsSettings();
  }

  function logSms(entry) {
    db.prepare('INSERT INTO sms_log(recipient,profile_id,provider,status,detail,body) VALUES(?,?,?,?,?,?)')
      .run(entry.recipient || '', entry.profileId ? Number(entry.profileId) : null, entry.provider || '', entry.status || '', entry.detail || '', entry.body || '');
  }

  function smsHistory(limit = 20) {
    return db.prepare('SELECT id,sent_at AS sentAt,recipient,profile_id AS profileId,provider,status,detail FROM sms_log ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  // Foutmeldingen van een provider mogen nooit het token bevatten; daarom wordt
  // de tekst eerst opgeschoond tegen de bekende geheimen.
  function zonderGeheimen(tekst) {
    let uit = String(tekst || '');
    for (const sleutel of SECRET_KEYS) {
      const waarde = readSetting(sleutel);
      if (waarde && waarde.length > 3) uit = uit.split(waarde).join('[verborgen]');
    }
    return uit.slice(0, 300);
  }

  async function deliver(provider, to, body) {
    if (provider === 'webhook') {
      const url = readSetting('sms.webhookUrl');
      const token = readSetting('sms.webhookToken');
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const antwoord = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ to, from: readSetting('sms.from') || 'VoorraadThuis', body }) });
      if (!antwoord.ok) throw Error(`De gateway antwoordde met status ${antwoord.status}.`);
      return 'Verzonden via de eigen gateway.';
    }
    if (provider === 'cheapconnect') {
      // CheapConnect antwoordt altijd met HTTP 200; een fout zit in het veld
      // 'error' van de JSON (bijv. {"error":"2001: No API Key provided"}). Het
      // nummer gaat zonder plusteken: 31612345678 (zoals in hun eigen SDK).
      const sleutel = readSetting('sms.cheapconnectKey');
      const afzenderInstelling = readSetting('sms.from');
      // Een afzender die een nummer is, gaat er internationaal uit (31612345678);
      // een afzender in tekst blijft staan (maximaal 11 tekens).
      let afzender = afzenderInstelling;
      if (afzenderInstelling && /^\+?\d[\d\s()-]*$/.test(afzenderInstelling)) {
        try { afzender = normalizePhone(afzenderInstelling).replace(/^\+/, ''); } catch { afzender = afzenderInstelling.replace(/\D/g, ''); }
      }
      const antwoord = await fetchImpl(cheapconnectUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          apikey: sleutel,
          from: afzender,
          to: String(to).replace(/^\+/, ''),
          msg: body,
        }),
      });
      const uitleg = await antwoord.text();
      if (!antwoord.ok) throw Error(`CheapConnect antwoordde met status ${antwoord.status}: ${zonderGeheimen(uitleg)}`);
      let gegevens = null;
      try { gegevens = JSON.parse(uitleg); } catch { gegevens = null; }
      // Foutcodes beginnen met een nummer: 0 betekent geen fout.
      const fout = gegevens && gegevens.error !== undefined ? String(gegevens.error) : '';
      if (fout && !/^0\s*:/.test(fout)) throw Error(`CheapConnect weigerde het bericht: ${zonderGeheimen(fout)}`);
      if (!gegevens && !/success/i.test(uitleg)) throw Error(`Onverwacht antwoord van CheapConnect: ${zonderGeheimen(uitleg)}`);
      const kenmerk = gegevens && (gegevens.messageid || gegevens.messageId || gegevens.id || gegevens.msgid);
      return kenmerk ? `Verzonden via CheapConnect (${kenmerk}).` : 'Verzonden via CheapConnect.';
    }
    if (provider === 'twilio') {
      const sid = readSetting('sms.twilioSid');
      const token = readSetting('sms.twilioToken');
      const from = readSetting('sms.twilioFrom');
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const antwoord = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      });
      const uitleg = await antwoord.text();
      if (!antwoord.ok) throw Error(`Twilio weigerde het bericht (${antwoord.status}): ${zonderGeheimen(uitleg)}`);
      let id = '';
      try { id = JSON.parse(uitleg).sid || ''; } catch { id = ''; }
      return id ? `Verzonden via Twilio (${id}).` : 'Verzonden via Twilio.';
    }
    throw Error('Dit kanaal verstuurt geen berichten zelf.');
  }

  /**
   * Stuurt de boodschappenlijst naar een profiel of naar een los nummer.
   * Bij het kanaal 'link' gebeurt er niets op de server: de pagina krijgt een
   * sms:-koppeling terug met het nummer en de tekst erin.
   */
  async function sendShoppingList({ profileId, to, items, notes, sender } = {}) {
    const profiel = profileId ? getProfile(profileId) : null;
    const nummer = normalizePhone(to || (profiel && profiel.phone) || '');
    if (!nummer) throw Error('Kies een profiel met telefoonnummer of vul een nummer in.');
    const settings = getSmsSettings();
    const body = buildShoppingMessage(items, { sender: sender || settings.sender, profileName: profiel ? profiel.name : '', notes });
    if (settings.provider === 'link') {
      logSms({ recipient: nummer, profileId: profiel && profiel.id, provider: 'link', status: 'koppeling', detail: 'sms-koppeling gemaakt', body });
      return { sent: false, provider: 'link', to: nummer, toPretty: prettyPhone(nummer), body, link: `sms:${nummer}?&body=${encodeURIComponent(body)}` };
    }
    const reden = canSend(settings.provider);
    if (reden) throw Error(reden);
    try {
      const detail = await deliver(settings.provider, nummer, body);
      logSms({ recipient: nummer, profileId: profiel && profiel.id, provider: settings.provider, status: 'verzonden', detail, body });
      return { sent: true, provider: settings.provider, to: nummer, toPretty: prettyPhone(nummer), body, detail };
    } catch (fout) {
      const detail = zonderGeheimen(fout.message || fout);
      logSms({ recipient: nummer, profileId: profiel && profiel.id, provider: settings.provider, status: 'mislukt', detail, body });
      throw Error(detail);
    }
  }

  return {
    listProfiles, getProfile, createProfile, updateProfile, deleteProfile,
    normalizePhone, prettyPhone, buildShoppingMessage,
    getSmsSettings, saveSmsSettings, sendShoppingList, smsHistory,
    id: () => randomUUID(),
  };
}

module.exports = { createProfiles, normalizePhone, prettyPhone, buildShoppingMessage, PROVIDERS };
