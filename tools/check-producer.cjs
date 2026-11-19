const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../studio/producer-brain.js'), 'utf8'), scope);
const brain = scope.BriixProducer;
const voice = { instrumental: false, existingLyrics: '' };
const json = JSON.stringify({ title: 'Огни', prompt: 'jazz, 72 BPM', lyrics: 'Строка' });
assert.equal(brain.parse(json, voice).title, 'Огни');
assert.equal(brain.parse('```json\n' + json + '\n```', voice).lyrics, 'Строка');
assert.equal(brain.parse(json, { ...voice, existingLyrics: 'Своя\nлирика' }).lyrics, 'Своя\nлирика');
assert.throws(() => brain.parse('{"title":', voice));
assert.throws(() => brain.parse(JSON.stringify({ title: 'x', prompt: 'y', lyrics: '' }), voice));
assert.throws(() => brain.parse(json, { instrumental: true, existingLyrics: '' }));
assert.throws(() => brain.parse(JSON.stringify({ title: 'x', prompt: 'z'.repeat(brain.MAX_PROMPT + 1), lyrics: 'a' }), voice));
const messages = brain.messages({ idea: 'Песня про собаку без гитары, 72 BPM', instrumental: false, existingLyrics: 'Текст автора' });
assert.equal(messages.length, 2);
assert.equal(JSON.parse(messages[1].content).existing_lyrics, 'Текст автора');
assert.match(messages[0].content, /не приписывай конкретный темп/i);
assert.ok(brain.warnings('без женского вокала', 'female vocals', false).length);
assert.ok(brain.warnings('инструментал', 'jazz', false).length);
// ---------------------------------- резолвер стиля (референс → семейство) ----
// Владелец: «пользователь напишет название исполнителя, модель подберёт стиль,
// а мозг соберёт конструкцию». Имя артиста в prompt/lyrics не попадает никогда.
assert.ok(brain.STYLE_FAMILIES.length >= 20, 'список семейств стиля есть');
const withStyle = JSON.stringify({ title: 'Т', prompt: 'dream pop, wide pads', lyrics: '[verse]\nline', style: 'Dream  Pop' });
assert.equal(brain.parse(withStyle, voice).style, 'dream pop', 'семейство нормализуется (регистр/пробелы)');
const noStyle = JSON.stringify({ title: 'Т', prompt: 'warm pads', lyrics: 'line' });
assert.equal(brain.parse(noStyle, voice).style, '', 'без поля style черновик не падает');
const badStyle = JSON.stringify({ title: 'Т', prompt: 'warm pads', lyrics: 'line', style: 'как у Портishead' });
assert.equal(brain.parse(badStyle, voice).style, '', 'неизвестное семейство отбрасывается, а не ломает черновик');
assert.equal(brain.normalizeStyle('PSYCHEDELIC SOUL'), 'psychedelic soul');
assert.equal(brain.normalizeStyle(''), '');
// Правила в системном промте: семейства перечислены, имена запрещены.
assert.match(messages[0].content, /семейство стиля/i, 'в промте есть правило про семейство стиля');
assert.match(messages[0].content, /psychedelic soul/, 'список семейств доходит до модели');
assert.match(messages[0].content, /имя в prompt и lyrics НЕ пиши/i, 'имена артистов запрещены явно');
assert.match(messages[0].content, /"style"/, 'контракт JSON включает style');
// Эвристика «утечки имени» для карточки черновика.
assert.equal(brain.styleLeaks('warm like Portishead'), 1);
assert.equal(brain.styleLeaks('warm analog production'), 0);
console.log('PASS producer parsing, limits, original lyrics, warning heuristics, style resolver');
