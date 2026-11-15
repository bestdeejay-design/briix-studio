/* Музыкальный мозг BRIIX v2 — правила из репозитория dj1/brain.
 *
 * Это НЕ нейросеть и НЕ генерация: модуль детерминированно перекладывает
 * задумку с русского на caption ACE-Step по правилам мозга
 * (dj1/brain/knowledge/prompt-rules.md, model-acestep.md, song-structure.md,
 * style-taxonomy.md) и по доказательствам ресерча (audits/brain-v2/RESEARCH_PACK.md).
 *
 * ЧТО ИЗМЕНИЛОСЬ В v2 (issue #20, «Мозг v2: buildTags → продюсер-композиция caption»)
 *
 *   Философия владельца: не «сколько всего напихать», а «как правильно указать
 *   важное», чтобы модель сама допела остальное. Поэтому caption собирается не
 *   из плоского списка тегов, а из ТРЁХ СЛОЁВ + ХВОСТА, каждый слой = роль в
 *   миксе и одно решающее указание:
 *
 *     ANCHOR  жанр (+ эпоха, если задана)      — рамка, не слой
 *     L3 VOICE   голос: пол + подача + фактура  — кто поёт и как
 *     L2 RHYTHM  темп + грув + состав кита + низ — что качает
 *     L1 SPACE   инструменты + продакшн-цепочка — где и как записано
 *     TAIL       динамика + настроение + концепт — куда едет трек
 *
 *   Порядок блоков в строке caption — как в топ-промтах корпуса (score 407–448):
 *   жанр → вокал → BPM → ритм-секция → инструменты → продакшн → настроение →
 *   концепт. Первые блоки несут больший вес, поэтому при усечении по бюджету
 *   отрезается хвост, а не ритм/голос/продакшн.
 *
 *   Подробности и цифры: audits/brain-v2/RESEARCH_PACK.md (§3), обоснование
 *   выбора слоёв — там же. Там же — чем платим за 240 символов и почему
 *   полный продюсерский caption живёт в buildCaption (640), а компактный
 *   путь студии — в buildTags (240).
 *
 * Сохранённые правила (не менялись):
 *   - порядок тегов и словарь — только из таксономии корпуса (8202 трека);
 *   - никаких негативов: «без реверберации» → dry close-mic production;
 *   - вокальным трекам — тег языка лирики; дефолт язык — английский (#109);
 *   - темп указывается явно (N BPM), но не выдумывается;
 *   - модуль не ходит в сеть и не подменяет текст автора: только собирает
 *     caption и каркас лирики, каждая подстановка обратима («Вернуть задумку»).
 *
 * Экспорт в globalThis (студия и vm-тесты без window).
 */
(function () {
  'use strict';

  // MAX_TAGS — бюджет компактного пути (buildTags), исторический лимит студии
  // (#109): его проверяют tools/check-assembly.cjs и tools/check-studio.cjs.
  const MAX_TAGS = 240;
  // MAX_CAPTION — бюджет полного продюсерского caption (buildCaption).
  // Обоснование: ACE-Step кодирует caption через umT5 с truncation=True и
  // text_max_length=256 (acestep/pipeline_ace_step.py, get_text_embeddings) —
  // 640 символов ≈ 170–190 токенов, то есть внутри потолка; p90 длины промтов
  // корпуса — 641 символ, медиана топ-100 по score — 402.
  const MAX_CAPTION = 640;
  const SOURCE = 'dj1/brain · knowledge/prompt-rules.md + style-taxonomy.md + corpus 8202';

  // ---------------------------------------------------------------- словари ---
  // Словари — только теги таксономии корпуса (style-taxonomy.md).
  // Ключи — русские слова задумки, значения — теги ACE-Step.
  const GENRE_WORDS = [
    ['психоделик соул', 'psychedelic soul'], ['психоделик-соул', 'psychedelic soul'],
    ['психоделическ соул', 'psychedelic soul'], ['psychedelic soul', 'psychedelic soul'],
    ['соул', 'soul'], ['тех-хаус', 'tech house'], ['tech house', 'tech house'],
    ['техно-хаус', 'tech house'], ['хаус', 'house'], ['лоуфай', 'lo-fi'], ['lo-fi', 'lo-fi'],
    ['лоу-фай', 'lo-fi'], ['трэп', 'trap'], ['trap', 'trap'], ['эмбиент', 'ambient'],
    ['ambient', 'ambient'], ['поп', 'pop'], ['рок', 'rock'], ['джаз', 'jazz'],
    ['техно', 'techno'], ['хип-хоп', 'hip-hop'], ['рэп', 'rap'], ['фонк', 'phonk'],
    ['фанк', 'funk'], ['фолк', 'folk'], ['баллад', 'ballad'], ['трип-хоп', 'trip-hop'],
    ['синтвейв', 'synthwave'], ['ретровейв', 'synthwave'], ['шансон', 'chanson'],
    ['индастриал', 'industrial'], ['оркестр', 'orchestral'], ['транс', 'trance'],
    ['электро', 'edm'], ['r&b', 'r&b']
  ];
  const FORM_GENRE = {           // жанр из формы «Музыки» → тег таксономии
    lofi: 'lo-fi', ambient: 'ambient', cinematic: 'cinematic', pop: 'pop',
    electronic: 'house', acoustic: 'folk'
  };

  /* L2 RHYTHM — ритм-словарь (дыра №1 прошлой версии: без слова «бит/
     барабаны» в задумке барабаны не попадали в caption никогда).
     char   — характер звучания кита (прилагательное к груву);
     groove — что именно играет ритм-секция;
     kit    — состав кита (корпус: tight drum groove (kick + snare + ride)). */
  const RHYTHM_CHAR = [
    ['медленн', 'slow'], ['быстр', 'fast'], ['плотн', 'tight'], ['сух', 'dry'],
    ['мягк', 'soft'], ['живой', 'live'], ['грузн', 'heavy'], ['мощн', 'heavy'],
    ['ломаный', 'broken'], ['рваный', 'stuttering'], ['прямой', 'straight'],
    ['гипнотич', 'hypnotic'], ['покачива', 'rolling'], ['долбящ', 'driving'],
    ['пружинист', 'bouncy'], ['вкрадчив', 'unhurried'],
    ['разреженн', 'sparse'], ['разряженн', 'sparse'], ['рублен', 'chopped']
  ];
  const RHYTHM_GROOVE = [
    ['четыре четверти', 'four-on-the-floor kick groove'], ['four-on-the-floor', 'four-on-the-floor kick groove'],
    ['брейкбит', 'broken breakbeat'], ['драм-н-бейс', 'broken breakbeat'],
    ['брейк', 'breakbeat'], ['дроп', 'drop-led groove'], ['брейкдаун', 'breakdown groove'],
    ['вопрос-ответ', 'call-and-response drum pattern'],
    ['грув', 'drum groove'], ['ударн', 'drum groove'], ['барабан', 'drum groove'],
    ['бит', 'beat'], ['ритм', 'groove'], ['перкуссия', 'percussion groove'],
    ['пульс', 'steady pulse'], ['кик', 'kick-led groove'], ['снейр', 'snare-driven groove'],
    ['хэт', 'hi-hat pattern'], ['топот', 'stomping groove'], ['кача', 'swing groove']
  ];
  const RHYTHM_KIT = [
    ['кик + снейр', 'kick + snare'], ['кик и снейр', 'kick + snare'],
    ['kick + snare', 'kick + snare'], ['ride', 'ride cymbal'], ['райд', 'ride cymbal'],
    ['хэт', 'hi-hat'], ['том-том', 'toms'], ['томы', 'toms'], ['литавр', 'toms'], ['бонго', 'bongos'],
    ['конга', 'congas'], ['шейкер', 'shaker'], ['бубен', 'tambourine'],
    ['808', '808 kick'], ['909', '909 drums'], ['TR-909', '909 drums'],
    ['метёлк', 'brushed drums'], ['щёлк', 'finger snaps'], ['хлопк', 'claps']
  ];
  // Дефолт ритм-слоя по жанру: ритм в caption есть ВСЕГДА (приёмка #20).
  const RHYTHM_BY_GENRE = {
    'psychedelic soul': { char: 'tight', groove: 'drum groove', kit: 'kick + snare + ride' },
    'soul': { char: 'tight', groove: 'drum groove', kit: 'kick + snare + ride' },
    'tech house': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: '909 drums, offbeat hi-hats' },
    'house': { char: 'smooth', groove: 'four-on-the-floor kick groove', kit: 'kick + claps, offbeat hi-hats' },
    'techno': { char: 'driving', groove: 'straight kick pattern', kit: 'kick + ride, claps' },
    'lo-fi': { char: 'laid-back', groove: 'dusty drum loop', kit: 'soft kick + snare, brushed hats' },
    'trap': { char: 'sparse', groove: 'slow trap groove', kit: '808 kick, triplet hi-hats' },
    'hip-hop': { char: 'laid-back', groove: 'boom-bap groove', kit: 'kick + snare, vinyl-crunch hats' },
    'rap': { char: 'sparse', groove: 'slow groove', kit: '808 kick + snare' },
    'ambient': { char: 'beatless', groove: 'drift without a drum kit', kit: 'sub-bass pulse' },
    'cinematic': { char: 'slow', groove: 'cinematic pulse', kit: 'low toms + soft cymbals' },
    'jazz': { char: 'loose', groove: 'jazz drum groove', kit: 'brushed drums, ride cymbal' },
    'rock': { char: 'live', groove: 'live drum groove', kit: 'kick + snare + ride' },
    'pop': { char: 'clean', groove: 'steady pop groove', kit: 'kick + snare, claps' },
    'ballad': { char: 'slow', groove: 'sparse ballad groove', kit: 'soft kick + brushes' },
    'edm': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: 'kick + claps, 909 hats' },
    'trip-hop': { char: 'slow', groove: 'downtempo groove', kit: 'dusty kick + snare, vinyl hats' },
    'folk': { char: 'organic', groove: 'hand percussion groove', kit: 'shaker + tambourine' },
    'orchestral': { char: 'slow', groove: 'orchestral pulse', kit: 'timpani + low strings' }
  };
  const RHYTHM_FALLBACK = { char: 'steady', groove: 'drum groove', kit: 'kick + snare' };

  // Низ: бас — отдельная роль в миксе (в корпусе bass — самый частый инструмент).
  const BASS_WORDS = [
    ['живой бас', 'live bass guitar in front of the mix'],
    ['бас-гитар', 'live bass guitar'],
    ['bass guitar', 'live bass guitar'],
    ['саб', 'deep sub-bass'],
    ['808', '808 sub bass'],
    ['низк', 'deep low end'],
    ['бас', 'bass']
  ];

  /* L3 VOICE — голос: пол/регистр, подача, фактура.
     Дыра №2 прошлой версии: VOCAL_WORDS описывал только пол («female vocals»),
     из-за чего пропадал характер вокала, а «deep bass voice» уползал в
     фальцет на длинных секциях (реальный кейс «Лови» v2.1). */
  const VOCAL_GENDER = [
    ['женск', 'female vocals'], ['девочк', 'female vocals'], ['девич', 'female vocals'],
    ['мужск', 'male vocals'], ['парн', 'male vocals'], ['баритон', 'male baritone'],
    ['брутальн', 'male baritone'], ['бас-голос', 'deep bass voice'],
    ['низк мужск', 'deep bass voice'], ['глубокий голос', 'deep male voice'],
    ['глубокий мужск', 'deep bass voice'], ['низкий голос', 'deep bass voice'],
    ['тенор', 'male tenor'], ['хор', 'choir'],
    ['дуэт', 'duet vocals'], ['бэк-вокал', 'backing vocals']
  ];
  const VOCAL_DELIVERY = [
    ['шепот', 'whispered delivery'], ['шёпот', 'whispered delivery'],
    ['полушепот', 'half-whispered delivery'], ['нашёптыва', 'whispered delivery'],
    ['речитатив', 'spoken word'], ['spoken word', 'spoken word'],
    ['пропеван', 'spoken-sung'], ['spoken-sung', 'spoken-sung'],
    ['декламац', 'spoken word'], ['скандир', 'chanted delivery'],
    ['крик', 'screamed delivery'], ['кричит', 'screamed delivery'],
    ['подвыва', 'crooned delivery'], ['в полный голос', 'full-voice delivery'],
    ['тих', 'intimate delivery'], ['интимн', 'intimate delivery'],
    ['исповедальн', 'confessional delivery'], ['отстранён', 'detached delivery'],
    ['нежн', 'tender delivery']
  ];
  const VOCAL_TEXTURE = [
    ['хрип', 'hoarse rasp'], ['хрипл', 'hoarse rasp'], ['гравий', 'gravel texture'],
    ['gravel', 'gravel texture'], ['бархат', 'velvet tone'], ['бархатн', 'velvet tone'],
    ['придыхан', 'breathy tone'], ['дыхан', 'breathy tone'], ['шершав', 'rough texture'],
    ['фальцет', 'falsetto'], ['falsetto', 'falsetto'], ['грудн', 'chest voice'],
    ['чист', 'clean tone'], ['тёпл', 'warm timbre'], ['тепл', 'warm timbre'],
    ['стеклянн', 'glassy timbre'], ['глух', 'muffled tone']
  ];
  // Антифальцетный страж: «глубокий голос» обязан остаться в грудном регистре.
  // Негатив «без фальцета» перефразируется позитивно (model-acestep.md).
  const LOW_VOICE_HINTS = ['глубок', 'низк', 'бас', 'баритон', 'брутальн', 'грудн', 'мужск'];
  const FALSETTO_GUARD = 'chest voice, register never rises';

  // L1 SPACE — инструменты и продакшн-цепочка.
  const INSTRUMENT_WORDS = [
    ['акустическ гитар', 'acoustic guitar'], ['электрогитар', 'electric guitar'],
    ['удары органа', 'rhythmic organ stabs'], ['завихрен', 'swirling organ'],
    ['нарастани органа', 'organ swell'],
    ['бас-гитар', 'live bass guitar'], ['гитар', 'guitar'], ['пианин', 'piano'],
    ['роял', 'piano'], ['клавиш', 'keys'], ['орган', 'organ'], ['хаммонд', 'organ'], ['hammond', 'organ'],
    ['лесли', 'slow Leslie speaker'], ['leslie', 'slow Leslie speaker'], ['саксофон', 'saxophone'], ['скрипк', 'strings'],
    ['струнн', 'strings'], ['виолончел', 'cello'], ['контрабас', 'upright bass'],
    ['бас', 'bass'], ['808', '808'], ['синтезатор', 'synth'], ['синт', 'synth'],
    ['аккордеон', 'accordion'], ['барабан', 'drums'], ['бит', 'drums'],
    ['педал', 'pads'], ['пэд', 'pads'], ['флейт', 'flute'], ['труб', 'brass'],
    ['ф-но', 'piano'], ['родес', 'Fender Rhodes']
  ];
  // Продакшн-цепочка — «как записано». Отдельно от атмосферы: в корпусе это
  // разные роли (analog warmth / tape saturation против rain atmosphere).
  const PROD_WORDS = [
    ['винил', 'vinyl crackle'], ['трещин винил', 'vinyl crackle'], ['плёнк', 'tape saturation'],
    ['пленк', 'tape saturation'], ['аналог', 'analog warmth'], ['кассет', 'tape saturation'],
    ['трещащ', 'vinyl crackle'], ['live-', 'live room sound'], ['живой запис', 'live room sound'],
    ['сух', 'dry close-mic production'], ['плотн', 'tight mix'],
    ['широк', 'wide stereo image'], ['тёпл', 'analog warmth'], ['тепл', 'analog warmth'],
    ['эфир', 'AM radio broadcast texture'], ['радио', 'AM radio broadcast texture'],
    ['реверб', 'deep reverb space'], ['компресс', 'compressed vocal level'],
    ['эхо-задержк', 'tape echo delay'], ['эхо', 'tape echo'],
    ['реверс-пленк', 'reverse tape textures'], ['реверс-плёнк', 'reverse tape textures'],
    ['дрожание скорости', 'wow and flutter']
  ];
  // Атмосфера — «что слышно вокруг»: отдельный блок, не продакшн-цепочка.
  const ATMOS_WORDS = [
    ['дожд', 'rain atmosphere'], ['ночной город', 'night city'], ['пустын', 'desert air'],
    ['космос', 'space ambience'], ['кафе', 'cafe ambience'], ['склад', 'warehouse air'],
    ['помех', 'radio static'], ['туман', 'foggy room tone'], ['море', 'sea in the low end'],
    ['ветер', 'wind texture'], ['толп', 'crowd noise'], ['комнатная тишин', 'room silence']
  ];
  // Продакшн-цепочка по жанру — чтобы слой существовал даже без слов о записи.
  const PROD_BY_GENRE = {
    'psychedelic soul': ['tape saturation', 'analog warmth'],
    'soul': ['analog warmth', 'warm rounded low end'],
    'tech house': ['clean modern production', 'wide stereo mix'],
    'house': ['clean modern production', 'tight low end'],
    'techno': ['dry driving production', 'wide stereo mix'],
    'lo-fi': ['tape saturation', 'vinyl crackle'],
    'trap': ['clean modern production', 'punchy low end'],
    'hip-hop': ['tape saturation', 'punchy low end'],
    'ambient': ['tape saturation', 'deep reverb space'],
    'cinematic': ['wide cinematic mix', 'deep reverb space'],
    'jazz': ['live room sound', 'analog warmth'],
    'rock': ['live room sound', 'punchy midrange'],
    'pop': ['clean modern production', 'wide stereo mix'],
    'ballad': ['intimate close-mic production', 'analog reverb'],
    'edm': ['clean modern production', 'tight low end']
  };
  const PROD_FALLBACK = ['analog warmth'];
  // Где записано — «хвост» продакшна, только если в задумке есть место/эпоха.
  const PLACE_WORDS = [
    ['подвал', 'basement studio'], ['пакгауз', 'waterfront warehouse studio'],
    ['студи', 'studio room tone'], ['в зале', 'live hall'], ['крыша', 'rooftop'],
    ['кухн', 'kitchen recording'], ['радио', 'pirate radio studio'],
    ['побережь', 'coastal studio'], ['портов', 'harbour studio'],
    ['порт ', 'harbour studio'], ['порт,', 'harbour studio'], ['в порту', 'harbour studio']
  ];

  // TAIL — динамика, настроение, концепт.
  const DYNAMICS_WORDS = [
    ['волн', 'wave dynamics'], ['нарастан', 'slow build'], ['разгон', 'build'],
    ['почти-тишин', 'near-silent suspensions before drums re-enter'],
    ['почти тишин', 'near-silent suspensions before drums re-enter'],
    ['тишин', 'near-silent suspensions before drums re-enter'],
    ['сброс', 'drop'], ['затуха', 'fading outro'], ['раскачк', 'swelling dynamics'],
    ['постоянн', 'steady energy'], ['ровн', 'steady energy'],
    ['без кульминац', 'flat dynamics, loop-like'], ['без кульминаци', 'flat dynamics, loop-like']
  ];
  const MOOD_WORDS = [
    ['грустн', 'melancholic'], ['груст', 'melancholic'], ['тоск', 'melancholic'],
    ['печал', 'melancholic'], ['ностальг', 'nostalgic'], ['темн', 'dark'], ['тёмн', 'dark'],
    ['мрачн', 'dark'], ['гипнотич', 'hypnotic'], ['кинематограф', 'cinematic'],
    ['нежн', 'emotional'], ['мечтат', 'dreamy'], ['энергичн', 'euphoric'],
    ['спокойн', 'dreamy'], ['романтич', 'emotional'], ['холодн', 'cold'],
    ['возвышенн', 'ethereal'], ['агрессив', 'aggressive'], ['тревожн', 'haunting'],
    ['тёпл', 'warm'], ['тепл', 'warm'], ['городск', 'urban'], ['атмосферн', 'atmospheric'],
    ['психоделич', 'psychedelic'], ['психоделическ', 'psychedelic'], ['приподнят', 'euphoric'],
    ['чувственн', 'sensual'], ['сексуальн', 'sensual'], ['сюрреал', 'surreal'],
    ['медитативн', 'meditative'], ['торжественн', 'anthemic']
  ];
  const ERA_WORDS = [
    ['70-е', '70s'], ['70-х', '70s'], ['70х', '70s'], ['семидесят', '70s'], ['1970', '70s'],
    ['80-е', '80s'], ['80-х', '80s'], ['80х', '80s'], ['восьмидесят', '80s'], ['1980', '80s'],
    ['90-е', '90s'], ['90-х', '90s'], ['90х', '90s'], ['девяност', '90s'], ['1990', '90s']
  ];
  // Концепт-строка: тема лирики как её назвал автор, без домыслов.
  const CONCEPT_WORDS = [
    ['ночной город', 'night city'], ['ночь', 'night'], ['город', 'city'],
    ['море', 'sea'], ['порт', 'harbour'], ['туман', 'fog'], ['дожд', 'rain'],
    ['дорог', 'road'], ['поезд', 'trains'], ['одиночеств', 'loneliness'],
    ['память', 'memory'], ['время', 'time'], ['свобод', 'freedom'],
    ['любов', 'love'], ['разлук', 'separation'], ['мечт', 'dreams'],
    ['страх', 'fear'], ['тишина', 'silence'], ['тишине', 'silence'], ['плёнк', 'tape'], ['пленк', 'tape'],
    ['радио', 'radio'], ['эфир', 'broadcast'], ['свет', 'light'], ['тьма', 'darkness']
  ];
  // Негативы задумки → позитивные теги (brain/knowledge/model-acestep.md).
  const POSITIVE = [
    [/без\s+реверб/i, 'dry close-mic production'],
    [/без\s+кульмина/i, 'flat dynamics, loop-like'],
    [/без\s+фальцет/i, 'full-voice delivery'],
    [/без\s+женск/i, 'male vocals only'],
    [/без\s+мужск/i, 'female vocals only'],
    [/без\s+(слов|вокал|текст)/i, 'instrumental'],
    [/no\s+reverb/i, 'dry close-mic production'],
    [/no\s+climax/i, 'flat dynamics, loop-like'],
    [/no\s+falsetto/i, 'full-voice delivery'],
    [/no\s+female/i, 'male vocals only'],
    [/no\s+male/i, 'female vocals only'],
    [/no\s+(lyrics|vocals)/i, 'instrumental']
  ];
  const LANG_TAGS = { ru: 'Russian lyrics', en: 'English lyrics', fr: 'French lyrics' };
  const FORM_MOOD = { calm: 'dreamy', warm: 'warm', bright: 'euphoric', dramatic: 'dark' };

  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  /* Отрицание рядом со словом: «без фальцета», «no falsetto», «не шёпотом».
     Такое слово НЕ описывает желаемое и не должно становиться позитивным тегом
     (иначе «без фальцета» превращается в falsetto — инверсия смысла). */
  const NEGATORS = ['без ', 'без-', 'no ', 'not ', 'не ', 'безо '];
  function negated(text, word) {
    const w = norm(word);
    let idx = text.indexOf(w);
    while (idx >= 0) {
      const before = text.slice(Math.max(0, idx - 12), idx);
      // Первое НЕотрицаемое употребление делает слово положительным признаком.
      if (!NEGATORS.some(n => before.endsWith(n) || before.endsWith(n.trim() + ' '))) return false;
      idx = text.indexOf(w, idx + 1);
    }
    // Все употребления оказались под отрицанием — слово не положительный признак.
    return true;
  }

  // Скан словаря: совпадения возвращаются в порядке ПОЯВЛЕНИЯ В ТЕКСТЕ, а не в
  // порядке словаря. Так режется по max именно то, что автор сказал раньше
  // (его акцент), а не то, что случайно выше лежит в словаре.
  function scan(text, pairs, max) {
    const found = [];
    for (const [word, tag] of pairs) {
      const pos = text.indexOf(norm(word));
      if (pos < 0 || negated(text, word)) continue;
      if (found.some(h => h.tag === tag)) continue;
      found.push({ from: word, tag, pos });
    }
    // Тег-в-теге внутри одного словаря: «bass»/«guitar» не должны съедать слоты
    // у «live bass guitar», если автор сказал «бас-гитара».
    const strict = found.filter(h => !found.some(o => o !== h && o.tag.includes(h.tag)));
    strict.sort((a, b) => a.pos - b.pos);
    return (max ? strict.slice(0, max) : strict).map(({ from, tag }) => ({ from, tag }));
  }

  const uniq = list => list.filter((v, i) => v && list.indexOf(v) === i);

  /* ------------------------------------------------------------ слои caption */

  // «без ударных» — позитивная переформулировка: не колотим drums, а описываем
  // безударный дрейф (негативов в caption не бывает, model-acestep.md).
  const NO_DRUMS = /без\s+(ударн|барабан|бит|перкусси)/i;

  function pickRhythm(text, genre, options) {
    if (NO_DRUMS.test(text)) {
      return {
        phrase: 'beatless drift, low strings and room tone only',
        groove: 'beatless drift', kit: 'low strings only', char: 'beatless',
        from: { groove: ['без ударных'], kit: [] }
      };
    }
    const grooveHit = scan(text, RHYTHM_GROOVE, 2);
    const kitHit = scan(text, RHYTHM_KIT, 2);
    const charHit = scan(text, RHYTHM_CHAR, 2);
    const profile = RHYTHM_BY_GENRE[genre] || RHYTHM_FALLBACK;
    const chars = uniq(charHit.map(h => h.tag).concat(grooveHit.length ? [] : [profile.char]));
    const groove = grooveHit.length ? grooveHit[0].tag : profile.groove;
    // Кит = слова автора + состав из жанрового профиля (дедуп: «hi-hat» не
    // дублируется рядом с «triplet hi-hats»).
    // Хит кита не дублирует профиль: «ride cymbal» уходит, если в профиле уже
    // есть «kick + snare + ride»; «hi-hat» — если есть «triplet hi-hats».
    const profileWords = profile.kit.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
    const kitHits = kitHit.map(h => h.tag).filter(tag => {
      const words = tag.toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 3);
      return !words.some(w => profileWords.includes(w));
    });
    const kit = kitHits.length
      ? dedupeTags([kitHits.join(', ') + ', ' + profile.kit]).join(', ')
      : profile.kit;
    // «beat» без характера не описывает микс — дополняем слово-носитель до «drum groove».
    const grooveWord = groove === 'beat' ? 'drum beat' : groove;
    // Порядок прилагательных: сначала скорость/вес, потом характер — иначе
    // получается «hypnotic soft drum groove».
    const CHAR_ORDER = ['slow', 'fast', 'heavy', 'sparse', 'steady', 'live', 'laid-back',
      'soft', 'tight', 'dry', 'rolling', 'hypnotic', 'driving', 'broken', 'bouncy',
      'straight', 'chopped', 'unhurried', 'beatless', 'loose', 'organic', 'clean', 'smooth'];
    const head = uniq(chars.length ? chars : [profile.char])
      .sort((a, b) => CHAR_ORDER.indexOf(a) - CHAR_ORDER.indexOf(b));
    return {
      phrase: [head.join(' ') + ' ' + grooveWord, '(' + kit + ')'].join(' '),
      groove: grooveWord, kit, char: head.join(' '), from: { groove: grooveHit.map(h => h.from), kit: kitHit.map(h => h.from) }
    };
  }

  function pickVoice(text, options) {
    const isSong = options.kind === 'song';
    const gender = scan(text, VOCAL_GENDER, 2);
    const delivery = scan(text, VOCAL_DELIVERY, 2);
    const texture = scan(text, VOCAL_TEXTURE, 2);
    // Страж срабатывает только когда речь о голосе: «глубокий ритм» — не голос.
    const voiceWords = /(голос|вокал|поет|поёт|пени|баритон|шепот|шёпот|речитатив|подпев)/.test(text);
    const lowRegister = gender.some(g => ['male baritone', 'deep bass voice', 'male vocals', 'male tenor'].includes(g.tag))
      || (voiceWords && LOW_VOICE_HINTS.some(w => text.includes(norm(w))));
    const falsettoAsked = !negated(text, 'фальцет') || !negated(text, 'falsetto');
    const antiFalsetto = lowRegister && !falsettoAsked;
    const genderTags = gender.length ? gender.map(g => g.tag) : (isSong ? ['vocals'] : []);
    const character = [];
    delivery.forEach(d => character.push(d.tag));
    texture.forEach(t => character.push(t.tag));
    if (antiFalsetto && !character.includes('falsetto')) character.push(FALSETTO_GUARD);
    // Фактура есть всегда для песни: без неё голос описывает только пол.
    if (isSong && !character.length) character.push('intimate delivery');
    return {
      tags: uniq(genderTags.concat(character)),
      genderTags: uniq(genderTags),
      characterTags: uniq(character),
      character: delivery.map(d => d.tag).concat(texture.map(t => t.tag)),
      antiFalsetto,
      from: { gender: gender.map(g => g.from), delivery: delivery.map(d => d.from), texture: texture.map(t => t.from) }
    };
  }

  function pickSpace(text, genre) {
    const instruments = scan(text, INSTRUMENT_WORDS, 5).map(i => i.tag);
    const prodHits = scan(text, PROD_WORDS, 3).map(p => p.tag);
    const atmos = scan(text, ATMOS_WORDS, 2).map(a => a.tag);
    const place = scan(text, PLACE_WORDS, 1).map(p => p.tag);
    // «без реверберации» → дефолты с ревербом не подставляем (иначе caption
    // противоречит сам себе: dry close-mic и analog reverb рядом).
    const noReverb = /без\s+реверб|no\s+reverb/i.test(text);
    const defaults = (PROD_BY_GENRE[genre] || PROD_FALLBACK)
      .filter(t => !noReverb || !/reverb/.test(t));
    // Продакшн-цепочка существует всегда: слова автора + жанровый дефолт до 2 тегов.
    const chain = uniq(prodHits.concat(defaults)).slice(0, 3);
    return {
      instruments: uniq(instruments), production: chain, atmosphere: uniq(atmos), place,
      from: { instruments, production: prodHits, atmosphere: atmos }
    };
  }

  /* Сборка всех слоёв из задумки. Возвращает структуру, из которой потом
     собирается строка caption (и которая доступна вызывающему для отладки). */
  function composeLayers(brief, options = {}) {
    const text = norm(brief);
    const isSong = options.kind === 'song';

    // Жанр: слово из задумки сильнее жанра формы; без жанра — жанр формы.
    const genreHits = scan(text, GENRE_WORDS, 2);
    const genreAll = genreHits.map(g => g.tag);
    // «soul» не дублируем, если уже есть «psychedelic soul» (тег-в-теге).
    const genreTags = genreHits.length
      ? genreAll.filter(t => !genreAll.some(o => o !== t && o.includes(t)))
      : [FORM_GENRE[options.genre]].filter(Boolean);
    const primaryGenre = genreTags[0] || (options.genre ? null : null);

    const era = scan(text, ERA_WORDS, 1).map(e => e.tag);
    const mood = scan(text, MOOD_WORDS, 2).map(m => m.tag);
    if (!mood.length) mood.push(FORM_MOOD[options.mood] || 'atmospheric');
    const dynamics = scan(text, DYNAMICS_WORDS, 2).map(d => d.tag);
    const conceptAll = uniq(scan(text, CONCEPT_WORDS, 2).map(c => c.tag));
    const concept = conceptAll.filter(t => !conceptAll.some(o => o !== t && o.includes(t)));
    const bpm = options.bpm ? Math.max(60, Math.min(180, Math.round(Number(options.bpm)))) + ' BPM' : null;
    const bass = uniq(scan(text, BASS_WORDS, 2).map(b => b.tag));
    // Негативы задумки → позитивные теги (model-acestep.md). Живут отдельным
    // блоком: это прямые требования автора, их срезает бюджет последними.
    const positives = uniq(POSITIVE.filter(([re]) => re.test(brief || '')).map(([, tag]) => tag));

    return {
      anchor: { genre: uniq(genreTags), era },
      voice: isSong ? pickVoice(text, options) : { tags: [], character: [], from: {} },
      rhythm: Object.assign(pickRhythm(text, primaryGenre, options), { bpm, bass }),
      space: pickSpace(text, primaryGenre),
      positives,
      tail: { dynamics, mood: uniq(mood), concept },
      instrumental: !isSong
    };
  }

  /* Строка caption из слоёв. Порядок — формула корпуса:
     жанр → вокал → BPM → ритм-секция → инструменты → продакшн → настроение → концепт.
     Приоритет при усечении: якорь жанра и три слоя (voice / rhythm / space)
     важнее хвоста; концепт режется первым, потом эпоха, потом лишние инструменты. */
  /* Дедуп на уровне тегов: «hi-hat» не нужен рядом с «hi-hat pattern», «bass» —
     рядом с «808 sub bass». Оставляем более точную формулировку. */
  // Запятые внутри скобок — часть состава кита («909 drums, offbeat hi-hats»),
  // поэтому режем только на верхнем уровне.
  function splitTags(text) {
    const out = []; let depth = 0; let cur = '';
    for (const ch of String(text)) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(Boolean);
  }

  function dedupeTags(list) {
    const flat = [];
    list.forEach(text => splitTags(text).forEach(t => { if (t && !flat.includes(t)) flat.push(t); }));
    return flat.filter(t => !flat.some(o => o !== t && o.toLowerCase().includes(t.toLowerCase())));
  }

  function renderCaption(layers, options = {}) {
    const budget = options.budget || MAX_CAPTION;
    const { anchor, voice, rhythm, space, tail } = layers;
    const units = [];   // {block, text, priority}
    const seen = new Set(); // теги уже прозвучали — второй раз не повторяем
    // Убираем повторы тегов между блоками («flat dynamics» из динамики и из
    // перефразированного негатива; «drums» в инструментах и в составе кита).
    const fresh = list => list.filter(t => {
      const key = t.toLowerCase();
      // «bass» теряется, если уже прозвучало «live bass guitar in front of the mix».
      const insideOther = [...seen].some(o => o.includes(key) && o !== key);
      if (seen.has(key) || insideOther) return false;
      seen.add(key);
      return true;
    });
    const skip = options.skipBlocks || [];   // инструментам бенчмарка: убрать слой
    const add = (block, list, priority) => {
      if (skip.includes(block)) return;
      const text = Array.isArray(list) ? fresh(list).join(', ') : (list || '');
      if (text) units.push({ block, text, priority });
    };

    // Порядок блоков = формула корпуса (жанр → вокал → BPM → ритм-секция →
    // инструменты → продакшн → настроение → концепт).
    add('anchor.genre', anchor.genre, 1);
    if (layers.instrumental) add('instrumental', ['instrumental'], 1);
    // «male vocals» избыточно, если назван конкретный регистр (baritone / bass voice).
    const registers = (voice.genderTags || []).filter(t => /baritone|tenor|bass voice|choir|duet/.test(t));
    add('voice.gender', (voice.genderTags || []).filter(t => !registers.length || /baritone|tenor|bass voice|choir|duet/.test(t)), 1);
    add('voice.character', voice.characterTags || [], 1);
    if (options.kind === 'song') add('voice.language', [LANG_TAGS[options.language] || LANG_TAGS.en], 1);
    // Ритм — ядро (приоритет 1): «caption обязан содержать ритм-слой всегда»
    // (приёмка #20), поэтому бюджет его не срезает никогда.
    add('rhythm.groove', [rhythm.phrase], 1);
    add('rhythm.bpm', rhythm.bpm ? [rhythm.bpm] : [], 1);
    add('rhythm.bass', rhythm.bass, 3);
    // generic-инструменты «drums»/«bass» не нужны: их роль уже описана слоями.
    add('space.instruments', space.instruments.filter(t => t !== 'drums'), 3);
    add('space.atmosphere', (space.atmosphere || []).slice(0, 2), 3);
    add('space.production', space.production.slice(0, 3), 1);
    add('positives', layers.positives || [], 1);
    add('space.place', space.place.slice(0, 1), 4);
    add('anchor.era', anchor.era, 4);
    add('tail.dynamics', tail.dynamics, 3);
    add('tail.mood', tail.mood.slice(0, 2), 3);
    add('tail.concept', tail.concept.length ? ['lyrics about ' + tail.concept.join(' and ')] : [], 5);

    // Усечение по бюджету: выкидываем блоки по убыванию приоритета-номера
    // (5 → 4 → 3 → 2), порядок внутри строки сохраняется; три слоя
    // (voice / rhythm / space) и позитивы автора не режутся никогда.
    let kept = units.slice();
    const fits = list => list.map(u => u.text).join(', ');
    const dropped = [];
    for (const level of [5, 4, 3, 2]) {
      if (fits(kept).length <= budget) break;
      for (let i = kept.length - 1; i >= 0; i--) {
        if (fits(kept).length <= budget) break;
        if (kept[i].priority === level) { dropped.unshift(kept[i].block); kept.splice(i, 1); }
      }
    }
    // Второй рубеж: снимаем блоки по одному в порядке «сначала самое необязательное».
    // Ритм (rhythm.groove/bpm) и голос не снимаются никогда — это ядро.
    const sacrifice = ['space.place', 'anchor.era', 'tail.concept', 'space.atmosphere',
      'space.instruments', 'rhythm.bass', 'tail.dynamics', 'tail.mood', 'positives'];
    for (const block of sacrifice) {
      if (fits(kept).length <= budget) break;
      let idx = kept.map(u => u.block).lastIndexOf(block);
      if (idx < 0) continue;
      // Инструменты — по одному с конца, остальные блоки целиком.
      while (fits(kept).length > budget && idx >= 0) {
        const parts = block === 'space.instruments' ? kept[idx].text.split(', ') : [kept[idx].text];
        if (parts.length <= 1) { kept.splice(idx, 1); dropped.unshift(block); break; }
        parts.pop();
        kept[idx] = { block, text: parts.join(', '), priority: kept[idx].priority };
      }
    }
    // Третий рубеж: продакшн-цепочка ужимается до одного тега (слой остаётся).
    while (fits(kept).length > budget) {
      const idx = kept.map(u => u.block).lastIndexOf('space.production');
      if (idx < 0) break;
      const parts = kept[idx].text.split(', ');
      if (parts.length <= 1) break;
      parts.pop();
      kept[idx] = { block: 'space.production', text: parts.join(', '), priority: 1 };
      dropped.unshift('часть продакшн-цепочки');
    }
    // Гигиена формата ACE-Step: без точек в конце, без двойных запятых.
    // Регистр тегов уже строчный, но «N BPM» остаётся как принято в таксономии.
    const caption = dedupeTags(kept.map(u => u.text)).join(', ')
      .replace(/\s*\.\s*(?=,|$)/g, '').replace(/,\s*,/g, ',').trim();
    // Бюджет может быть меньше физического минимума (жанр + голос + ритм +
    // продакшн). Тогда честно едем за бюджет и пишем это в notes — молчаливой
    // деградации не бывает.
    return { caption, dropped, blocks: kept.map(u => u.block), overBudget: caption.length > budget };
  }

  /* Самопроверка caption: три слоя обязаны присутствовать (приёмка #20).
     Возвращает {ok, missing[], notes[]}; в notes — только утверждения. */
  function selfCheck(caption, layers) {
    const missing = [];
    const notes = [];
    const has = re => re.test(caption);
    if (!has(/groove|beat|drum|kick|percussion|pulse/)) { missing.push('rhythm'); notes.push('ритм-слой отсутствует: caption не описывает, что качает'); }
    if (!layers.instrumental) {
      const hasVoice = has(/vocal|baritone|tenor|choir|voice/);
      const hasCharacter = has(/whisper|spoken|sung|rasp|gravel|velvet|breath|hoarse|chest voice|delivery|tone|timbre/);
      if (!hasVoice) { missing.push('voice'); notes.push('вокальный слой отсутствует: не указано, кто поёт'); }
      else if (!hasCharacter) { missing.push('voice-character'); notes.push('вокальный слой без характера: указан только пол голоса'); }
    } else if (!has(/instrumental/)) { missing.push('instrumental'); notes.push('инструментальный трек без тега instrumental'); }
    if (!has(/production|mix|saturation|warmth|close-mic|reverb|stereo|room sound|room tone|vinyl|low end|sub-bass|atmosphere|ambience|static|broadcast/)) {
      missing.push('production');
      notes.push('продакшн-слой отсутствует: не указано, как записан трек');
    }
    return { ok: missing.length === 0, missing, notes };
  }

  function buildCaption(brief, options = {}) {
    const layers = composeLayers(brief, options);
    const rendered = renderCaption(layers, Object.assign({}, options, { budget: options.maxTags || MAX_CAPTION }));
    const check = selfCheck(rendered.caption, layers);
    const notes = [];
    const push = (tag, from, layer) => { if (tag && !notes.some(n => n.tag === tag)) notes.push({ from: from || null, tag, layer: layer || null }); };
    layers.anchor.genre.forEach(t => push(t, 'жанр', 'anchor'));
    if (layers.anchor.era.length) layers.anchor.era.forEach(t => push(t, 'эпоха', 'anchor.era'));
    layers.voice.tags.forEach(t => push(t, 'вокал', 'voice'));
    if (options.kind === 'song') push(LANG_TAGS[options.language] || LANG_TAGS.en, 'язык вокала', 'voice');
    if (layers.rhythm.bpm) push(layers.rhythm.bpm, 'темп', 'rhythm');
    push(layers.rhythm.phrase, 'ритм-слой', 'rhythm');
    layers.rhythm.bass.forEach(t => push(t, 'бас', 'rhythm.bass'));
    layers.space.instruments.forEach(t => push(t, 'инструменты', 'space'));
    if (layers.space.atmosphere) layers.space.atmosphere.forEach(t => push(t, 'атмосфера', 'space.atmosphere'));
    layers.space.production.forEach(t => push(t, 'продакшн', 'space.production'));
    layers.space.place.forEach(t => push(t, 'место записи', 'space.place'));
    layers.tail.dynamics.forEach(t => push(t, 'динамика', 'tail'));
    layers.tail.mood.forEach(t => push(t, 'настроение', 'tail'));
    if (layers.tail.concept.length) push('lyrics about ' + layers.tail.concept.join(' and '), 'концепт', 'tail.concept');
    if (layers.instrumental) push('instrumental', 'инструментал', 'instrumental');
    // Записи о том, что ресёрч/бюджет срезали: это не ошибка, а видимая деградация.
    if (rendered.dropped.length) notes.push({ from: 'бюджет caption', tag: 'срезано: ' + uniq(rendered.dropped).join(', '), layer: 'budget' });
    if (rendered.overBudget) notes.push({ from: 'бюджет caption', tag: 'бюджет меньше минимума трёх слоёв: caption ' + rendered.caption.length + ' > ' + (options.maxTags || MAX_CAPTION), layer: 'budget' });
    check.notes.forEach(n => notes.push({ from: 'self-check', tag: n, layer: 'self-check' }));
    return {
      caption: rendered.caption,
      tags: rendered.caption,
      layers,
      notes,
      selfCheck: check,
      source: SOURCE,
      version: VERSION,
      budget: options.maxTags || MAX_CAPTION
    };
  }

  /* Компактный путь студии (обратная совместимость #109):
     buildTags(brief, options) → { tags, notes, source } плюс слои и selfCheck.
     Бюджет по умолчанию 240 символов — его проверяют vm-тесты и карточка трека.
     Полный продюсерский caption (3 слоя + хвост, до 640) — buildCaption(). */
  function buildTags(brief, options = {}) {
    const budget = Math.min(Number(options.maxTags) || MAX_TAGS, MAX_TAGS);
    const result = buildCaption(brief, Object.assign({}, options, { maxTags: budget }));
    return {
      tags: result.caption,
      notes: result.notes,
      layers: result.layers,
      selfCheck: result.selfCheck,
      source: SOURCE,
      version: VERSION,
      budget
    };
  }

  /* Каркас лирики по brain/knowledge/song-structure.md.
     Только метки секций и звуковые указания — текст автор вписывает сам;
     существующий текст модуль никогда не перезаписывает. */
  function buildLyricsSkeleton(brief, options = {}) {
    const text = norm(brief);
    const isSong = options.kind === 'song';
    if (!isSong) return '[Instrumental]';
    const fx = [];
    if (text.includes('дожд')) fx.push('rain');
    if (text.includes('винил') || text.includes('кассет')) fx.push('vinyl crackle');
    if (text.includes('ночной город') || text.includes('город')) fx.push('night city ambience');
    if (text.includes('космос')) fx.push('space ambience');
    const sound = fx.length ? ': ' + fx.join(', ') : '';
    // Базовая структура поп/рок-баллады из song-structure.md; припев повторяется
    // явно, бридж один. Секции — канонические английские метки ACE-Step.
    return [
      '[Intro' + sound + ']',
      '',
      '[Verse 1]',
      '',
      '',
      '',
      '',
      '[Pre-Chorus]',
      '',
      '',
      '[Chorus]',
      '',
      '',
      '',
      '',
      '[Verse 2]',
      '',
      '',
      '',
      '',
      '[Chorus]',
      '',
      '',
      '',
      '',
      '[Bridge]',
      '',
      '',
      '[Chorus]',
      '',
      '',
      '',
      '',
      '[Outro]',
      ''
    ].join('\n');
  }

  /* Темп из текста задумки: «72 BPM», «90 ударов в минуту», «120 уд. в мин».
     Ничего не выдумываем — не распознали, значит тега темпа не будет. */
  function detectBpm(brief) {
    const m = String(brief || '').match(/(\d{2,3})\s*(?:bpm|уд\s*\.?\s*в\s*\.?\s*мин|ударов\s*в\s*минуту)/i);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 30 && n <= 300 ? n : null;
  }

  const VERSION = '2026-11-15-studio-2';

  globalThis.BRIIX_MUSIC_BRAIN = {
    version: VERSION,
    source: SOURCE,
    buildTags,
    buildCaption,
    composeLayers,
    renderCaption,
    selfCheck,
    buildLyricsSkeleton,
    detectBpm,
    // словари и слои открыты для проверок и отладки
    rules: {
      MAX_TAGS, MAX_CAPTION, POSITIVE, LANG_TAGS,
      layerOrder: ['anchor', 'voice', 'rhythm', 'space', 'tail'],
      captionOrder: ['genre', 'vocals', 'bpm', 'rhythm-section', 'instruments', 'production', 'mood', 'concept'],
      tagOrder: ['genre', 'instruments', 'vocals', 'bpm', 'mood', 'era', 'production'],
      dictionaries: {
        GENRE_WORDS, RHYTHM_CHAR, RHYTHM_GROOVE, RHYTHM_KIT, RHYTHM_BY_GENRE, BASS_WORDS,
        VOCAL_GENDER, VOCAL_DELIVERY, VOCAL_TEXTURE, INSTRUMENT_WORDS, PROD_WORDS,
        PROD_BY_GENRE, PLACE_WORDS, DYNAMICS_WORDS, MOOD_WORDS, ERA_WORDS, CONCEPT_WORDS
      }
    }
  };
  if (typeof window !== 'undefined') window.BRIIX_MUSIC_BRAIN = globalThis.BRIIX_MUSIC_BRAIN;
})();
