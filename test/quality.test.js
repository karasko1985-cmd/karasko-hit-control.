import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, normalizeBrief, normalizeDirection, normalizeSong, structuralProblems,
  normalizeReview, chooseCandidate, buildSong
} from '../quality.js';

const direction = {
  genre: 'Polski uliczny hip-hop', bpm: 96, mood: 'Ciepły i energiczny', topic: 'Powrót na osiedle',
  vocal: 'Niski męski głos', production: 'Sucha perkusja i ciepły bas', why: 'Pasuje do historii',
  structure: 'Refren, zwrotka, refren, zwrotka, refren', rhymePlan: 'Naturalne pary: bramy / znamy', alternatives: []
};
const song = {
  title: 'Nasze bramy', concept: 'Powrót do miejsca, które zmieniło się po latach.',
  hook: 'Jeszcze stoją nasze bramy',
  lyrics: '[Chorus]\nJeszcze stoją nasze bramy\nTylko my się inaczej znamy\n\n[Verse 1]\nNa podwórku został ślad\nKtoś zamalował stary znak\nPod balkonem czeka brat\nW dłoni trzyma pęknięty hak\n\n[Chorus]\nJeszcze stoją nasze bramy\nTylko my się inaczej znamy\n\n[Verse 2]\nTeraz wolniej mijam blok\nStare drzwi odbiły krok\nKładę torbę obok ściany\nZnowu słyszę głos zza bramy\n\n[Final Chorus]\nJeszcze stoją nasze bramy\nTylko my się inaczej znamy',
  style: 'Polish hip-hop, 96 BPM, dry breakbeat drums, warm bass, restrained piano motif, low male rap, open chorus.',
  exclude: 'Shouting, distorted vocals'
};
const evidence = {
  rhymes: 'bramy', flow: 'Na podwórku został ślad', naturalness: 'Kładę torbę obok ściany',
  hook: song.hook, story: 'Znowu słyszę głos zza bramy', originality: 'W dłoni trzyma pęknięty hak',
  style_fit: '96 BPM'
};
function rawReview(value = 8) {
  return {
    scores: Object.fromEntries(CATEGORIES.map(k => [k, value])), issues: [], fixes: [], verdict: 'Tekst spójny z kierunkiem.',
    evidence: CATEGORIES.map(category => ({ category, quote: evidence[category], reason: `Konkretny fragment dla ${category}.` })),
    rhymePairs: [{ first: 'bramy', second: 'znamy', reason: 'Współbrzmienie końcówek.' }]
  };
}
function review(scores = {}, issues = []) {
  return { scores: { ...Object.fromEntries(CATEGORIES.map(k => [k, 8])), ...scores }, structural: [], issues };
}

test('manual brief keeps topic, preferences, genre, tempo and mood for all stages', () => {
  const payload = { autoMatch: false, genre: 'Techno / electro-rap', bpm: '142', mood: 'Euforyczny', topic: 'Nocny powrót', preferences: 'Bez pianina', mode: 'fast' };
  assert.deepEqual(normalizeBrief(payload), {
    autoMatch: false, genre: payload.genre, bpm: 142, mood: payload.mood, topic: payload.topic,
    preferences: payload.preferences, quality: 'fast'
  });
  const brief = normalizeBrief(payload);
  const normalized = normalizeDirection({ ...direction, genre: 'Wrong genre', bpm: 100, topic: 'Wrong topic', mood: 'Wrong mood' }, brief);
  assert.equal(normalized.genre, brief.genre);
  assert.equal(normalized.bpm, brief.bpm);
  assert.equal(normalized.topic, brief.topic);
  assert.equal(normalized.mood, brief.mood);
});

test('automatic brief ignores hidden manual defaults and clamps explicit manual BPM', () => {
  const auto = normalizeBrief({ genre: 'Hidden option', bpm: 96, mood: 'Hidden mood', topic: 'Moja historia' });
  assert.equal(auto.genre, null);
  assert.equal(auto.bpm, null);
  assert.equal(auto.mood, null);
  assert.equal(auto.topic, 'Moja historia');
  assert.equal(normalizeBrief({ autoMatch: 'false', bpm: 999 }).bpm, 180);
  assert.equal(normalizeBrief({ autoMatch: false, bpm: 'invalid' }).bpm, 96);
});

test('invalid briefs and malformed model songs are rejected', () => {
  for (const input of [null, [], 'topic', 1]) assert.throws(() => normalizeBrief(input));
  for (const input of [null, [], { ...song, lyrics: undefined }, { ...song, lyrics: 123 }, { ...song, title: 'x'.repeat(101) }]) {
    assert.throws(() => normalizeSong(input));
  }
  assert.deepEqual(normalizeSong({ ...song, title: `  ${song.title}  ` }), song);
});

test('malformed directions and invalid tempo are rejected before writing', () => {
  const brief = normalizeBrief({});
  for (const input of [null, [], { ...direction, bpm: 'NaN' }, { ...direction, bpm: 200 }, { ...direction, rhymePlan: '' }]) {
    assert.throws(() => normalizeDirection(input, brief));
  }
});

test('complete song passes structure; empty sections, absent verses and BPM mismatch fail', () => {
  assert.deepEqual(structuralProblems(song, direction), []);
  assert.ok(structuralProblems({ ...song, lyrics: '[Chorus]\n\n[Verse 1]\n\n[Verse 2]\n' }, direction).length >= 2);
  assert.ok(structuralProblems({ ...song, style: song.style.replace('96 BPM', '142 BPM') }, direction).some(s => /BPM/.test(s)));
  assert.ok(structuralProblems({ ...song, style: `${song.style} Alternative: 120 BPM.` }, direction).some(s => /BPM/.test(s)));
  assert.ok(structuralProblems({ ...song, hook: 'Fragment, którego nie ma w piosence' }, direction).some(s => /hook/.test(s)));
  assert.ok(structuralProblems({ ...song, lyrics: song.lyrics.replace('[Verse 2]', '[Verse 1]') }, direction).some(s => /zwrotki/.test(s)));
});

test('a verse-only quote cannot stand in for a chorus hook and a final empty tag is detected', () => {
  const verseHook = structuralProblems({ ...song, hook: 'W dłoni trzyma pęknięty hak' }, direction);
  assert.ok(verseHook.some(issue => /hook/.test(issue)));
  const trailingEmpty = structuralProblems({ ...song, lyrics: `${song.lyrics}\n\n[Outro]` }, direction);
  assert.ok(trailingEmpty.some(issue => /pust/.test(issue)));
});

test('review accepts actual quotations and keeps audio limitations visible', () => {
  const result = normalizeReview(rawReview(), song, direction);
  assert.equal(result.passed, true);
  assert.equal(result.evidence.length, CATEGORIES.length);
  assert.equal(result.rhymePairs.length, 1);
  assert.deepEqual(result.structural, []);
  assert.match(result.limitations, /odsłuchu/);
});

test('fabricated quotations cannot support high ratings', () => {
  const raw = rawReview(9.5);
  raw.evidence = raw.evidence.map(item => item.category === 'style_fit' ? { ...item, quote: 'Fictional 155 BPM metallic groove' } : item);
  const result = normalizeReview(raw, song, direction);
  assert.equal(result.scores.style_fit, 6);
  assert.equal(result.scores.hook, 9.5);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some(s => /style_fit/.test(s)));
});

test('unconfirmed or identical rhyme pairs cap rhymes despite a generous critic', () => {
  for (const pairs of [[], [{ first: 'bramy', second: 'bramy', reason: 'Identical word' }], [{ first: 'bramy', second: 'zmyślony fragment', reason: 'Missing quote' }]]) {
    const raw = rawReview(9);
    raw.rhymePairs = pairs;
    const result = normalizeReview(raw, song, direction);
    assert.equal(result.scores.rhymes, 6);
    assert.equal(result.passed, false);
  }
});

test('malformed review scores fail and malformed evidence entries cannot inflate scores', () => {
  for (const input of [null, {}, { ...rawReview(), scores: { ...rawReview().scores, flow: NaN } }, { ...rawReview(), scores: { ...rawReview().scores, rhymes: 11 } }]) {
    assert.throws(() => normalizeReview(input, song, direction));
  }
  const result = normalizeReview({ ...rawReview(9), evidence: [null, 123, {}], rhymePairs: [null, {}] }, song, direction);
  assert.ok(CATEGORIES.every(k => result.scores[k] <= 6));
  assert.equal(result.passed, false);
});

test('selection rejects rhyme and style regression even if all other scores improve', () => {
  const current = review();
  for (const category of ['rhymes', 'style_fit', 'flow', 'naturalness', 'hook']) {
    const candidate = review(Object.fromEntries(CATEGORIES.map(k => [k, k === category ? 7 : 9])));
    assert.equal(chooseCandidate(current, candidate, 'B').better, false, category);
  }
});

test('selection accepts improvement of the weakest category and rejects a tie', () => {
  assert.equal(chooseCandidate(review({ rhymes: 6 }), review({ rhymes: 6.3 })).better, true);
  assert.equal(chooseCandidate(review(), review()).better, false);
  const bad = { ...review(), structural: ['Empty verse'] };
  assert.equal(chooseCandidate(review(), bad, 'B').better, false);
});

function scriptedAI(maxCalls, { revise = false, failRevision = false } = {}) {
  const ai = { maxCalls, usage: { calls: 0 }, model: 'mock-writer', reviewModel: 'mock-reviewer', inputs: [] };
  ai.call = async args => {
    if (ai.usage.calls >= ai.maxCalls) throw new Error('Hard call limit');
    ai.usage.calls++;
    ai.inputs.push(args);
    if (args.name === 'music_direction') return { ...direction };
    if (args.name === 'song') return { ...song };
    if (args.name === 'review') return { ...rawReview(), issues: ['Dopracuj refren.'], fixes: ['Dodaj konkretny obraz.'] };
    if (args.name === 'revised_song') {
      if (failRevision) throw new Error('Simulated timeout');
      return { ...song, title: 'Poprawiony numer' };
    }
    if (args.name === 'comparison') {
      const revisedA = args.input.A.title === 'Poprawiony numer';
      const original = { ...rawReview(), issues: ['Dopracuj refren.'] };
      const improved = rawReview(revise ? 8.5 : 7);
      return { A: revisedA ? improved : original, B: revisedA ? original : improved,
        preferred: revisedA ? 'A' : 'B', reason: 'Porównanie według jednej skali.' };
    }
    throw new Error(`Unexpected stage ${args.name}`);
  };
  return ai;
}

test('writing and revision calls are marked for the lower writer effort', async () => {
  const ai = scriptedAI(7, { revise: true });
  await buildSong({}, ai);
  const flagged = name => ai.inputs.find(item => item.name === name).writing === true;
  assert.equal(flagged('song'), true);
  assert.equal(flagged('revised_song'), true);
  assert.equal(flagged('music_direction'), false);
  assert.equal(flagged('review'), false);
  assert.equal(flagged('comparison'), false);
});

test('every build stage receives the full manual brief including review', async () => {
  const ai = scriptedAI(3);
  const payload = { autoMatch: false, genre: direction.genre, bpm: 96, mood: direction.mood, topic: direction.topic, preferences: 'Bez pianina' };
  await buildSong(payload, ai);
  assert.equal(ai.usage.calls, 3);
  for (const request of ai.inputs) assert.deepEqual(request.input.brief, normalizeBrief(payload));
});

test('pipeline reserves revision and comparison calls, keeps exactly one final selection', async () => {
  for (const maxCalls of [3, 4, 5, 6, 7]) {
    const ai = scriptedAI(maxCalls, { revise: true });
    const result = await buildSong({}, ai);
    assert.ok(ai.usage.calls <= maxCalls);
    assert.equal(ai.usage.calls, maxCalls >= 5 ? 5 : 3);
    assert.equal(result.revisions.filter(r => r.selected).length, 1);
    assert.equal(result.selectedIteration, maxCalls >= 5 ? 2 : 1);
    assert.equal(result.song.title, maxCalls >= 5 ? 'Poprawiony numer' : song.title);
  }
});

test('fast mode skips revisions and a failed revision preserves an assessed complete song', async () => {
  const fastAI = scriptedAI(7);
  const fast = await buildSong({ mode: 'fast' }, fastAI);
  assert.equal(fastAI.usage.calls, 3);
  assert.equal(fast.song.title, song.title);
  const failureAI = scriptedAI(7, { failRevision: true });
  const result = await buildSong({}, failureAI);
  assert.equal(result.song.title, song.title);
  assert.equal(result.revisions.length, 1);
  assert.match(result.warnings.join(' '), /Simulated timeout/);
});
