const $ = id => document.getElementById(id);
const labels = {
  rhymes: 'Rymy', flow: 'Flow', naturalness: 'Naturalność', hook: 'Refren',
  story: 'Spójność i rozwój', originality: 'Oryginalność', style_fit: 'Dopasowanie stylu'
};
let current = null;
let busy = false;
let pendingJob = null;
const jobStorageKey = 'karasko.pendingJob';
const autoBox = $('autoMatch');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const asList = value => Array.isArray(value) ? value : (value ? [value] : []);

function updateMode() {
  $('manualOptions').classList.toggle('hidden', autoBox.checked);
  $('manualOptions').querySelectorAll('input, select').forEach(input => { input.disabled = autoBox.checked; });
}
autoBox.addEventListener('change', updateMode);
updateMode();

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Błąd połączenia (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

request('/api/status').then(data => {
  $('status').textContent = data.configured ? `● API aktywne · ${data.model}` : '● API wymaga konfiguracji na serwerze';
  $('status').classList.add(data.configured ? 'connected' : 'not-configured');
  $('modelInfo').textContent = data.configured
    ? `Autor: ${data.model}. Recenzent: ${data.reviewModel || data.model}. Limit serwera: ${data.maxCalls} wywołań na numer.`
    : 'Klucz OpenAI ustaw w panelu hostingu. Nie wpisuj go w formularzu utworu.';
}).catch(() => { $('status').textContent = 'Nie udało się sprawdzić połączenia'; });

function setTab(tab) {
  document.querySelectorAll('.tab').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('.tab-content').forEach(element => {
    element.classList.toggle('hidden', element.id !== `tab-${tab}`);
  });
}
document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));

function showList(id, values, empty = 'Brak uwag w tej rundzie.') {
  const items = asList(values);
  $(id).replaceChildren(...(items.length ? items : [empty]).map(value => {
    const li = document.createElement('li');
    li.textContent = String(value);
    return li;
  }));
}

function formatSong(data) {
  const { song } = data;
  return `KARASKO — ${song.title || 'Bez tytułu'}\n\n${song.concept || ''}\n\n=== LYRICS ===\n${song.lyrics || ''}\n\n=== STYLE ===\n${song.style || ''}\n\n=== EXCLUDE ===\n${song.exclude || ''}\n`;
}

function render(data) {
  current = data;
  const { song, review, usage = {}, revisions = [] } = data;
  $('empty').classList.add('hidden');
  $('output').classList.remove('hidden');
  $('title').textContent = song.title || 'Bez tytułu';
  $('concept').textContent = song.concept || '';
  const direction = data.direction;
  $('direction').classList.toggle('hidden', !direction);
  if (direction) {
    $('direction').textContent = [
      `${direction.genre} · ${direction.bpm} BPM · ${direction.mood}`,
      direction.vocal, direction.production, direction.why
    ].filter(Boolean).join('\n');
  }
  $('lyrics').textContent = song.lyrics || '';
  $('style').textContent = song.style || '';
  $('exclude').textContent = song.exclude || '';
  $('combined').textContent = formatSong(data);
  $('verdict').textContent = `${review.passed ? 'Próg redakcyjny spełniony. ' : 'Wybrano najlepszą wersję w dostępnym limicie. '}${review.verdict || ''}`;
  $('scores').replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const numeric = review.scores?.[key];
    const value = typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
    const card = document.createElement('div');
    card.className = `score ${value !== null && value >= 8 ? 'good' : 'low'}`;
    const strong = document.createElement('strong');
    strong.textContent = value === null ? '—' : `${value.toFixed(1)}/10`;
    const span = document.createElement('span');
    span.textContent = label;
    card.append(strong, span);
    return card;
  }));
  showList('issues', review.issues);
  showList('fixes', review.fixes);
  const evidence = asList(review.evidence).map(item => typeof item === 'string' ? item : [
    labels[item.category] || item.category,
    item.quote ? `„${item.quote}”` : '', item.reason
  ].filter(Boolean).join(' — '));
  showList('evidence', evidence, 'Recenzent nie podał dodatkowych cytatów.');
  const limitations = asList(review.limitations);
  $('limitations').textContent = ['Oceny dotyczą tekstu i opisu stylu. Rytm, melodię, wokal i finalne brzmienie trzeba sprawdzić w odsłuchu.', ...limitations].join(' ');
  const warnings = asList(data.warnings);
  $('warnings').classList.toggle('hidden', warnings.length === 0);
  showList('warnings', warnings);
  $('iterations').replaceChildren(...revisions.map((revision, index) => {
    const p = document.createElement('p');
    p.className = 'iteration fine';
    const isFinal = data.selectedIteration != null
      ? Number(data.selectedIteration) === Number(revision.iteration ?? index + 1)
      : revision.selected && !revisions.slice(index + 1).some(item => item.selected);
    if (isFinal) p.classList.add('selected');
    const points = Object.entries(revision.scores || {}).map(([key, score]) => `${labels[key] || key}: ${score}`).join(' · ');
    p.textContent = `Runda ${revision.iteration ?? index + 1}${isFinal ? ' — wersja końcowa' : ''}: ${points}${revision.decision ? `. ${revision.decision}` : ''}`;
    return p;
  }));
  const cost = Number.isFinite(data.estimatedUsd)
    ? `Szacowany koszt: $${data.estimatedUsd.toFixed(4)} według stawek serwera.`
    : 'Koszt nieoszacowany; sprawdź zużycie w panelu OpenAI.';
  $('usage').textContent = `Autor: ${data.model || '—'} · Recenzent: ${data.reviewModel || data.model || '—'} · Wywołania: ${usage.calls ?? '—'} · Tokeny wejścia: ${usage.input ?? '—'} · Tokeny wyjścia: ${usage.output ?? '—'}. ${cost}`;
  setTab('combined');
}

function rememberJob(id) {
  pendingJob = id;
  try {
    if (id) sessionStorage.setItem(jobStorageKey, id);
    else sessionStorage.removeItem(jobStorageKey);
  } catch { /* Wynik pozostaje dostępny bez pamięci sesji. */ }
}

function setBusy(value) {
  busy = value;
  $('go').disabled = value || Boolean(pendingJob);
  $('resume').disabled = value;
  $('form').setAttribute('aria-busy', String(value));
  $('loading').classList.toggle('hidden', !value);
  $('resume').classList.toggle('hidden', value || !pendingJob);
  if (value) {
    $('empty').classList.add('hidden');
    $('error').classList.add('hidden');
  }
}

async function pollJob(id) {
  let delay = 1500;
  let failures = 0;
  for (;;) {
    let job;
    try {
      job = await request(`/api/jobs/${encodeURIComponent(id)}`);
      failures = 0;
    } catch (error) {
      if (error.status === 404 || error.status === 410) {
        rememberJob(null);
        throw new Error('Zadanie nie jest już dostępne. Serwer mógł zostać ponownie uruchomiony; możesz utworzyć nowy numer.');
      }
      if (error.status === 401 || error.status === 403 || ++failures >= 5) {
        throw new Error('Przerwano połączenie. Użyj „Sprawdź trwające zadanie”, aby odebrać wynik bez uruchamiania kolejnej generacji.');
      }
      $('progress').textContent = 'Przywracanie połączenia z trwającym zadaniem…';
      await wait(Math.min(15000, delay * failures));
      continue;
    }
    if (job.status === 'completed') {
      if (!job.result?.song || !job.result?.review) {
        throw new Error('Wynik ma niepełny format. Spróbuj ponownie sprawdzić trwające zadanie.');
      }
      rememberJob(null);
      render(job.result);
      return;
    }
    if (job.status === 'failed') {
      rememberJob(null);
      throw new Error(job.error || 'Nie udało się ukończyć numeru.');
    }
    $('progress').textContent = job.progress?.message || (job.status === 'queued' ? 'Numer czeka na rozpoczęcie…' : 'Trwa pisanie i redakcja numeru…');
    await wait(delay);
    delay = Math.min(5000, Math.round(delay * 1.15));
  }
}

function showError(error) {
  $('error').textContent = error.name === 'TimeoutError'
    ? 'Serwer nie odpowiedział na czas. Sprawdź połączenie przed ponownym uruchomieniem.'
    : error.message;
  $('error').classList.remove('hidden');
  if (!current) $('empty').classList.remove('hidden');
}

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || pendingJob) return;
  setBusy(true);
  $('progress').textContent = 'Przygotowanie kierunku muzycznego…';
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.autoMatch = autoBox.checked;
    const job = await request('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!job.id) throw new Error('Serwer nie zwrócił identyfikatora zadania.');
    rememberJob(job.id);
    await pollJob(job.id);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});

async function resumeJob() {
  if (busy || !pendingJob) return;
  setBusy(true);
  $('progress').textContent = 'Sprawdzanie trwającego zadania…';
  try { await pollJob(pendingJob); }
  catch (error) { showError(error); }
  finally { setBusy(false); }
}
$('resume').addEventListener('click', resumeJob);
try { pendingJob = sessionStorage.getItem(jobStorageKey); } catch { /* Pamięć sesji jest opcjonalna. */ }
if (pendingJob) resumeJob();

document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy === 'combined' ? formatSong(current) : (current.song[button.dataset.copy] || ''));
    const label = button.dataset.label || button.textContent;
    button.dataset.label = label;
    button.textContent = 'Skopiowano ✓';
    setTimeout(() => { button.textContent = label; }, 1600);
  } catch {
    $('copyFeedback').textContent = 'Nie udało się skopiować. Zaznacz tekst ręcznie lub pobierz plik TXT.';
  }
}));

$('download').addEventListener('click', () => {
  if (!current) return;
  const { song, review } = current;
  const content = `${formatSong(current)}\n=== KIERUNEK ===\n${JSON.stringify(current.direction, null, 2)}\n\n=== OCENA REDAKCYJNA AI ===\n${JSON.stringify(review, null, 2)}\n\n=== HISTORIA POPRAWEK ===\n${JSON.stringify(current.revisions, null, 2)}\n`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `KARASKO_${(song.title || 'utwor').replace(/[^a-zA-Z0-9ąęćłńóśźż -]/gi, '').replace(/\s+/g, '_')}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
});
