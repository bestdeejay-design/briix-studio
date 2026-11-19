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
 *     ANCHOR  жанр (+ эпоха, если задана)         — рамка, не слой
 *     L3 VOICE   пол/регистр + подача + фактура   — кто поёт и как
 *     L2 RHYTHM  темп + грув + состав кита + низ  — что качает
 *     L1 SPACE   инструменты и их роли + микс +
 *                продакшн-цепочка + место         — из чего и как записано
 *     L4 ARRANGEMENT  форма и энергия во времени  — что происходит по ходу
 *     TAIL       динамика + настроение + концепт  — куда едет трек
 *   плюс блок GUARDS — защита от дрейфа в позитивной форме (без негативов).
 *
 *   Число блоков — не догма: это эмпирика корпуса. Средний score растёт до
 *   пяти «ролевых» блоков (30,2 при 5 против 15,8 при 1), после шести — плато
 *   и спад. Поэтому «полный трек» = 5 ролей + якорь + хвост, а не 3 и не 12:
 *   три роли (голос/ритм/пространство) различают звук, но не описывают форму
 *   (32 % топ-100 против 13,7 %) и роли инструментов (55 % против 28 %).
 *
 *   Порядок блоков в строке caption — как в топ-промтах корпуса (score 407–448):
 *   жанр → вокал → BPM → ритм-секция → инструменты → продакшн → настроение →
 *   концепт. Первые блоки несут больший вес, поэтому при усечении по бюджету
 *   отрезается хвост, а не ритм/голос/продакшн.
 *
 *   Подробности и цифры: audits/brain-v2/RESEARCH_PACK.md (§3), обоснование
 *   выбора слоёв — там же. Там же — чем платим за 240 символов и почему
 *   полный продюсерский caption живёт в buildCaption (640) и с 16.11 это
 *   единственный путь студии (решение владельца); buildTags (240) остался
 *   как legacy-путь обратной совместимости для карточек и старых вызовов.
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
  // Потолок модели — 256 токенов на промт (≈640–800 символов, audits/limits/
  // RESEARCH_PACK.md §2). Токенизатора mT5 в CI нет, поэтому сторож считает
  // слова консервативно: 190 слов ≈ 230–250 токенов — предупреждение до того,
  // как модель молча обрежет хвост.
  const MAX_CAPTION_WORDS = 190;
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
    ['тихий голос', 'intimate delivery'], ['интимн', 'intimate delivery'],
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
  // Голос — это идентичность, а не переменная. Пока о поле не сказано, в caption
  // уходило голое «vocals», и модель на каждой генерации бросала монетку:
  // мужской/женский без всякой зависимости от трека (владелец услышал это на
  // прогоне 15.11). Теперь пол выбирается детерминированно, в порядке
  // задумка → профиль слушателя → дефолт канала, и источник виден в notes.
  const VOICE_IDENTITY = { male: 'male vocals', female: 'female vocals' };
  const DEFAULT_VOICE_IDENTITY = 'male';
  const IDENTITY_RE = /female|male|baritone|tenor|bass voice|choir|duet/i;
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
  /* L3 DEPTH — «где это звучит и насколько далеко» + стилевая атмосфера.
     Причина появления: прогон v3 владельцем — «насытили, но глубины не
     достигали, стилевые акценты не поднялись». Ресёрч: глубина это КОНТРАСТ
     близкого и далёкого, а не один эффект на весь микс
     (audits/style-atmosphere/RESEARCH_PACK.md, §2).
     Слова автора сильнее стиля: сказал «пространство» — его слова идут первыми. */
  const DEPTH_WORDS = [
    ['глубин', 'front-to-back depth'], ['пространств', 'wide reverberant space'],
    ['эхо', 'tape echo'], ['реверб', 'plate reverb tail'],
    ['сух', 'dry close perspective'], ['вблизи', 'close perspective'],
    ['далек', 'distant perspective'], ['далёк', 'distant perspective'],
    ['комнат', 'room sound'], ['в зале', 'hall ambience'],
    ['воздух', 'air between instruments'], ['атмосфер', 'atmospheric depth'],
    ['погружен', 'immersive depth'], ['моно микс', 'mono centre'],
    ['карман', 'bass locked in the pocket with the kick']
  ];

  /* Стилевые пулы. Каждый приём — из жанровой практики (RESEARCH_PACK §1:
     D6–D9), а не выдуман. Из пула на трек берутся 2 приёма + 1 пара планов
     глубины по хешу задумки: один стиль — разные цепочки, но узнаваемый
     характер (требование «не жёсткие шаблоны, а перемешивать»). */
  const STYLE_ATMOSPHERE = {
    'psychedelic soul': {
      devices: ['dry dead drums with live room bleed', 'plate reverb on the snare',
        'tape echo on the guitar', 'spring reverb on the organ',
        'bass tone rolled off, staccato in the pocket with the kick',
        'loose unquantized groove', 'dubbed-out vocal fragments'],
      depth: ['close dry drums, wide room behind', 'dry upfront vocal over a distant plate tail']
    },
    'soul': {
      devices: ['warm plate on the horns', 'hand percussion in the midground',
        'bass locked in the pocket with the kick', 'live room bleed between players',
        'tape saturation on the drum bus'],
      depth: ['close vocal, band two steps back', 'dry rhythm section, distant horns']
    },
    'funk': {
      devices: ['dry tight drums, hi-hat in the foreground', 'wah guitar panned wide',
        'bass staccato, kick locked to the bass line', 'handclaps close-mic'],
      depth: ['everything close and dry, one distant room mic', 'close drums, wide room behind']
    },
    'dream pop': {
      devices: ['huge plate reverb on the guitars', 'reversed reverb bloom before the snare',
        'wide shimmering pads behind the vocal', 'soft focus low end'],
      depth: ['dry vocal floating over a distant band', 'guitars far back, vocal close']
    },
    'pop': {
      devices: ['dry upfront vocal', 'short plate on the snare',
        'wide synth pads behind the chorus', 'sidechained pads breathing'],
      depth: ['vocal in the foreground over a wide room', 'close drums, pads far behind']
    },
    'rock': {
      devices: ['close dry drums', 'cranked room mics', 'doubled guitars panned hard left and right'],
      depth: ['live band in one room, vocal upfront', 'close drums, room mics two metres back']
    },
    'techno': {
      devices: ['dry punchy kick', 'cavernous dub delay on the stab',
        'mono low end under a wide reverb tail', 'industrial room tone'],
      depth: ['dry kick close, echoes far behind', 'mono foreground, wide reverb tail']
    },
    'tech house': {
      devices: ['tight dry kick', 'short room on the hats',
        'wide filtered chords behind the groove', 'sidechained low end'],
      depth: ['dry kick in the foreground, chords far back', 'close groove, distant vocal chop']
    },
    'house': {
      devices: ['clean dry kick', 'vocal chops with delay throws',
        'wide filtered chords', 'club room reverb'],
      depth: ['dry kick close, room far behind', 'close vocal, wide chord wash']
    },
    'trap': {
      devices: ['808 with a long sub tail', 'short room on the hi-hats',
        'wide dark pads behind a dry vocal', 'sparse arrangement with clear depth'],
      depth: ['dry vocal close, 808 tail far behind', 'close hi-hats, wide pad wash']
    },
    'rap': {
      devices: ['dry upfront rap vocal', 'dead drum room', 'short delay throws on the ad-libs'],
      depth: ['vocal in the foreground, beat two steps back', 'dry vocal, distant dark pad']
    },
    'hip-hop': {
      devices: ['dead drum room', 'vinyl room tone behind the sample',
        'dry snare up close', 'wide dusty keys'],
      depth: ['sample far back, drums close', 'close vocal, dusty room behind']
    },
    'lo-fi': {
      devices: ['tape hiss', 'narrow mono mix', 'room bleed on everything'],
      depth: ['everything near and slightly dull', 'close cassette room, no air']
    },
    'ambient': {
      devices: ['long hall reverb', 'distant field recordings', 'slow evolving drone'],
      depth: ['everything far, nothing close', 'one close detail against an endless tail']
    },
    'cinematic': {
      devices: ['deep hall tail', 'wide low strings', 'close dry lead against a huge room'],
      depth: ['close lead, distant orchestra', 'dry soloist, hall far behind']
    },
    'orchestral': {
      devices: ['deep hall tail', 'wide string section', 'close dry solo lead'],
      depth: ['close soloist, hall far behind', 'strings far back, percussion close']
    },
    'jazz': {
      devices: ['live room sound, instruments bleeding together',
        'close upright bass, drums two steps back', 'plate on the horns'],
      depth: ['close bass, distant cymbals', 'one room, every instrument in it']
    },
    'ballad': {
      devices: ['intimate close-mic vocal', 'long plate behind the piano',
        'dry vocal, distant strings'],
      depth: ['vocal close, strings far behind', 'close piano, hall tail behind']
    },
    'edm': {
      devices: ['mono bass, wide reverb tail', 'sidechained pads', 'big room reverb on the drop'],
      depth: ['dry drop close, reverb far behind', 'mono low end, wide tail']
    },
    'synthwave': {
      devices: ['gated reverb on the snare', 'wide analog pads behind the lead',
        'tape saturation on the bus'],
      depth: ['close lead, gated room behind', 'dry bass, distant pad wash']
    },
    'trip-hop': {
      devices: ['dusty sampled drums up close', 'wide dark pads', 'dub delay on the vocal'],
      depth: ['close dusty drums, wide room behind', 'dry vocal, distant dark pad']
    },
    'r&b': {
      devices: ['dry intimate vocal', 'short plate on the snare', 'wide airy keys'],
      depth: ['vocal close, keys far behind', 'close drums, airy wash behind']
    },
    'folk': {
      devices: ['single close-mic guitar', 'room sound around the vocal', 'everything dry and near'],
      depth: ['everything close, one room mic', 'close guitar, distant room tone']
    }
  };
  // Базовая глубина: когда стиль не определён, но трек существует, геометрия
  // «близко/далеко» всё равно нужна — иначе микс плоский (D1–D3). Это не
  // выдумка про жанр: ни жанра, ни приёмов здесь нет, только планы.
  const DEPTH_BASE = [
    'close vocal, distant room',
    'dry foreground, wide room behind',
    'front-to-back depth, near and far layers',
    'close drums, distant reverb wash'
  ];
  // Синонимы жанровых тегов и подсказок резолвера → семейство STYLE_ATMOSPHERE.
  const STYLE_ALIASES = {
    'psychedelic soul': 'psychedelic soul', 'soul': 'soul', 'funk': 'funk',
    'dream pop': 'dream pop', 'dream-pop': 'dream pop', 'shoegaze': 'dream pop',
    'pop': 'pop', 'rock': 'rock', 'indie rock': 'rock',
    'techno': 'techno', 'tech house': 'tech house', 'house': 'house', 'edm': 'edm',
    'trap': 'trap', 'phonk': 'trap', 'rap': 'rap', 'хип-хоп': 'hip-hop', 'hip-hop': 'hip-hop',
    'lo-fi': 'lo-fi', 'ambient': 'ambient', 'cinematic': 'cinematic',
    'orchestral': 'orchestral', 'jazz': 'jazz', 'ballad': 'ballad',
    'synthwave': 'synthwave', 'trip-hop': 'trip-hop', 'r&b': 'r&b', 'folk': 'folk',
    'шансон': 'folk', 'industrial': 'techno', 'trance': 'edm', 'chanson': 'folk'
  };

  function hashText(text) {
    let h = 2166136261;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  /* Резолвер семейства стиля: явная подсказка резолвера (options.style,
     полученная из референса исполнителя) сильнее жанровых слов задумки. */
  function resolveStyle(genreTags, options = {}) {
    const asked = String(options.style || '').toLowerCase().trim();
    if (asked) {
      const key = STYLE_ALIASES[asked] || (STYLE_ATMOSPHERE[asked] ? asked : null);
      if (key) return { key, from: 'резолвер' };
    }
    for (const g of genreTags || []) {
      const key = STYLE_ALIASES[String(g).toLowerCase()] || (STYLE_ATMOSPHERE[g] ? g : null);
      if (key) return { key, from: 'жанр' };
    }
    return { key: null, from: null };
  }

  /* Слой глубины: слова автора + 2 приёма стиля + 1 пара планов «близко/далеко».
     Выбор приёмов — по хешу задумки: два трека одного стиля не получают одну и
     ту же цепочку, а один и тот же бриф всегда даёт один и тот же caption. */
  function pickDepth(text, style, seedText) {
    const asked = uniq(scan(text, DEPTH_WORDS, 2).map(d => d.tag));
    const profile = style && style.key ? STYLE_ATMOSPHERE[style.key] : null;
    const h0 = hashText(seedText + '|base');
    if (!profile) {
      const base = [DEPTH_BASE[h0 % DEPTH_BASE.length]];
      return { tags: uniq(asked.concat(base)), style: null, from: 'база',
        devices: [], depth: asked.length ? [] : base };
    }
    const h = hashText(seedText + '|' + style.key);
    const norms = t => t.toLowerCase();
    const free = profile.devices.filter(d => !asked.some(a => norms(a).includes(norms(d)) || norms(d).includes(norms(a))));
    // Перемешивание пула: у каждого приёма свой хеш от брифа, берём два первых.
    // (Шаг вида (h + k*7) % len при len=7 даёт один и тот же индекс — на этом
    // я уже обжёгся: в caption попадал ровно один приём вместо двух.)
    const want = asked.length >= 2 ? 1 : 2;
    const devices = free
      .map((d, i) => ({ d, k: hashText(seedText + '|' + style.key + '|' + i) }))
      .sort((a, b) => a.k - b.k)
      .slice(0, want)
      .map(o => o.d);
    const depth = [profile.depth[(h >>> 8) % profile.depth.length]];
    return {
      tags: uniq(asked.concat(devices, depth)), style: style.key, from: 'стиль',
      devices, depth
    };
  }

  // Где записано — «хвост» продакшна, только если в задумке есть место/эпоха.
  const PLACE_WORDS = [
    ['подвал', 'basement studio'], ['пакгауз', 'waterfront warehouse studio'],
    ['студи', 'studio room tone'], ['в зале', 'live hall'], ['крыша', 'rooftop'],
    ['кухн', 'kitchen recording'], ['радио', 'pirate radio studio'],
    ['побережь', 'coastal studio'], ['портов', 'harbour studio'],
    ['порт ', 'harbour studio'], ['порт,', 'harbour studio'], ['в порту', 'harbour studio']
  ];

  /* L4 ARRANGEMENT — форма и энергия во времени (корпус: 32 % топ-100 против
     13,7 %; lift 2,3×). Слой отвечает на вопрос «что происходит по ходу трека»,
     а не «из чего он сделан». */
  const ARRANGEMENT_WORDS = [
    ['холодн вступл', 'cold open on the groove'], ['без вступл', 'cold open on the groove'],
    ['вступление на', 'opening on texture'], ['вступленье на', 'opening on texture'],
    ['вступление с', 'opening on texture'], ['вступл', 'intro'],
    ['первый куплет', 'sparse first verse'], ['второй припев', 'fuller second chorus'],
    ['после второго припев', 'breakdown after the second chorus'],
    ['бридж', 'bridge'], ['кода', 'coda'], ['аутро', 'outro'],
    ['затуха', 'fading outro'], ['нарастан', 'build into the last chorus'],
    ['дроп', 'drop'], ['брейкдаун', 'breakdown'],
    ['без припев', 'through-composed, no repeated chorus'],
    ['без повтор', 'through-composed, evolving each section']
  ];

  /* L1 SPACE — роли инструментов и микс. В корпусе роли встречаются чаще, чем
     сами инструменты (55 % топ-100 против 28 %): «live bass carrying the main
     melody» сильнее, чем «bass». */
  const ROLE_WORDS = [
    ['ведущ', 'lead role'], ['ведет главн', 'carrying the main melody'],
    ['несет главн', 'carrying the main melody'],
    ['главн мелоди', 'carrying the main melody'], ['мелоди', 'melodic'],
    ['соло', 'solo'], ['рифф', 'riff'], ['аккорд', 'chords'],
    ['подложк', 'as a bed'], ['фоном', 'in the background'],
    ['низко в микс', 'low in the mix'], ['впереди микс', 'in front of the mix'],
    ['текстур', 'texture layer'], ['стаккато', 'staccato']
  ];
  const MIX_WORDS = [
    ['середин', 'present midrange'], ['верхн', 'open top end'],
    ['широк', 'wide stereo image'], ['глубин', 'front-to-back depth'],
    ['панч', 'punchy transients'], ['плотн', 'dense mix'],
    ['воздух', 'airy space around instruments'], ['сух', 'dry room']
  ];

  /* Защита от дрейфа — самый сильный признак корпуса (56 % топ-100 против 15 %,
     lift 3,7×), но у ACE-Step нет негативного поля: всё формулируется как
     утверждение о желаемом звуке. */
  const GUARD_WORDS = [
    ['без автотюн', 'unprocessed natural voice'],
    ['без вокалодер', 'unprocessed natural voice'],
    ['без дисторшн', 'clean tones'], ['без перегруз', 'clean tones'],
    ['без вибрато', 'straight-tone delivery'],
    ['без цифр', 'fully analog signal path'],
    ['без снейр', 'kick and hats only'],
    ['без хлопк', 'kick and snare only'],
    ['без ударн', 'beatless drift'],
    ['без климакс', 'flat dynamics, loop-like'],
    ['без реверб', 'dry close-mic production'],
    ['без фальцет', 'full-voice delivery'],
    ['только мужск', 'male vocals only'], ['только женск', 'female vocals only'],
    ['только живой', 'live instruments only'], ['только аналог', 'analog only']
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
  /* Короткий русский стем (≤3 букв) ищем только на границе слова: иначе «рок»
     ловится в «широкий», «поп» — в «попытка», «бит» — в «убитый». */
  const CYR = /[а-я0-9]/;
  function shortStem(text, w, from) {
    if (w.length > 3 || !/[а-я]/.test(w)) return text.indexOf(w, from);
    let idx = text.indexOf(w, from);
    while (idx >= 0) {
      const before = idx > 0 ? text[idx - 1] : '';
      if (!CYR.test(before)) return idx;
      idx = text.indexOf(w, idx + 1);
    }
    return -1;
  }

  function scan(text, pairs, max) {
    const found = [];
    for (const [word, tag] of pairs) {
      const pos = shortStem(text, norm(word), 0);
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
    // Профиль слушателя: options.voiceIdentity = 'male' | 'female'.
    const identityKey = String(options.voiceIdentity || '').toLowerCase();
    const identityTag = VOICE_IDENTITY[identityKey] || VOICE_IDENTITY[DEFAULT_VOICE_IDENTITY];
    const identityFrom = identityKey && VOICE_IDENTITY[identityKey] ? 'профиль' : 'дефолт канала';
    // Пол назван в задумке → он сильнее профиля. Названа только фактура
    // («бэк-вокал») → пол лида всё равно фиксируем, иначе он поплывёт.
    const askedIdentity = gender.some(g => IDENTITY_RE.test(g.tag));
    const genderTags = !isSong
      ? []
      : askedIdentity
        ? gender.map(g => g.tag)
        : gender.map(g => g.tag).concat(identityTag);
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
      identityTag: isSong && !askedIdentity ? identityTag : null,
      identityFrom: isSong && !askedIdentity ? identityFrom : 'задумка',
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
    // Роли инструментов, микс, форма и защита от дрейфа — блоки «полного трека».
    let roles = uniq(scan(text, ROLE_WORDS, 3).map(r => r.tag));
    // «carrying the main melody» уже содержит роль лида — общие слова лишние.
    if (roles.includes('carrying the main melody')) {
      roles = roles.filter(t => t !== 'lead role' && t !== 'melodic');
    }
    const mix = uniq(scan(text, MIX_WORDS, 2).map(m => m.tag));
    const arrangement = uniq(scan(text, ARRANGEMENT_WORDS, 3).map(a => a.tag))
      // «opening on texture» точнее, чем общее «intro»: общее убираем.
      .filter(t => t !== 'intro' || !/opening/.test(uniq(scan(text, ARRANGEMENT_WORDS, 4).map(a => a.tag)).join(' ')));
    const guards = uniq(scan(text, GUARD_WORDS, 2).map(g => g.tag));
    // Глубина и стилевая атмосфера: семейство стиля из жанра или из резолвера.
    const styleResolved = resolveStyle(genreTags, options);
    const depth = pickDepth(text, styleResolved, text);

    return {
      anchor: { genre: uniq(genreTags), era },
      voice: isSong ? pickVoice(text, options) : { tags: [], character: [], from: {} },
      rhythm: Object.assign(pickRhythm(text, primaryGenre, options), { bpm, bass }),
      space: pickSpace(text, primaryGenre),
      roles, mix, arrangement, guards, depth,
      style: styleResolved,
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
    const { anchor, voice, rhythm, space, tail, roles, mix } = layers;
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
    add('space.roles', roles || [], 3);
    add('space.mix', mix || [], 3);
    add('space.atmosphere', (space.atmosphere || []).slice(0, 2), 3);
    add('space.production', space.production.slice(0, 3), 1);
    // Глубина идёт сразу за продакшном: «как записано» → «где это стоит».
    // Приоритет 2: в полном caption (640) она есть всегда, в компактном бюджете
    // 240 уходит только вместе с остальными необязательными блоками.
    if (layers.depth && layers.depth.tags.length) {
      const d = layers.depth;
      // Компактный режим: один стилевой приём + пара планов, чтобы атмосфера
      // влезала в 240, а не вылетала целиком.
      const askedDepth = d.tags.filter(t => !d.devices.includes(t) && !d.depth.includes(t));
      const picked = budget <= 300
        ? uniq(askedDepth.concat(d.devices.slice(0, 1), d.depth))
        : d.tags;
      add('space.depth', picked, 2);
    }
    add('guards', layers.guards || [], 1);
    add('positives', layers.positives || [], 1);
    add('space.place', space.place.slice(0, 1), 4);
    add('anchor.era', anchor.era, 4);
    add('arrangement', (layers.arrangement || []), 3);
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
      'space.mix', 'space.roles', 'space.instruments', 'arrangement', 'rhythm.bass',
      'tail.dynamics', 'tail.mood', 'positives', 'guards', 'space.depth'];
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
    // Секции живут в лирике, а не в caption: [chorus] в поле стиля не работает
    // (audits/limits/RESEARCH_PACK.md §2, L4/L5).
    if (/\[(?:intro|verse|pre-chorus|chorus|bridge|interlude|instrumental|outro|hook|drop)\]/i.test(caption)) {
      notes.push('в caption попал секционный тег — такие метки работают только в лирике');
    }
    // Молчаливая обрезка: 256 токенов у промта, считаем слова с запасом.
    const words = String(caption).trim().split(/\s+/).filter(Boolean).length;
    if (words > MAX_CAPTION_WORDS) {
      notes.push('caption ' + words + ' слов (> ' + MAX_CAPTION_WORDS + '): хвост может обрезаться молча (256 токенов у модели)');
    }
    if (/[\r\n]/.test(String(caption))) notes.push('caption не однострочный: переводы строк ломают comma-список');
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
    if (layers.voice.identityTag) {
      push('идентичность голоса: ' + layers.voice.identityTag + ' (' + layers.voice.identityFrom + ')', 'голос', 'voice.identity');
    }
    if (options.kind === 'song') push(LANG_TAGS[options.language] || LANG_TAGS.en, 'язык вокала', 'voice');
    if (layers.rhythm.bpm) push(layers.rhythm.bpm, 'темп', 'rhythm');
    push(layers.rhythm.phrase, 'ритм-слой', 'rhythm');
    layers.rhythm.bass.forEach(t => push(t, 'бас', 'rhythm.bass'));
    layers.space.instruments.forEach(t => push(t, 'инструменты', 'space'));
    if (layers.space.atmosphere) layers.space.atmosphere.forEach(t => push(t, 'атмосфера', 'space.atmosphere'));
    layers.space.production.forEach(t => push(t, 'продакшн', 'space.production'));
    if (layers.depth) {
      layers.depth.tags.forEach(t => push(t, 'глубина', 'space.depth'));
      if (layers.depth.style) push('стиль: ' + layers.depth.style + ' (' + layers.depth.from + ')', 'стиль', 'space.depth');
    }
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

  /* Компактный путь (LEGACY с 16.11): buildTags(brief, options) →
     { tags, notes, source } плюс слои и selfCheck.
     Бюджет по умолчанию 240 символов — исторический лимит #109; в студии он
     больше не используется (владелец переключил генерацию на полный caption),
     но функция сохранена для обратной совместимости и карточек.
     Полный продюсерский caption (до 640) — buildCaption(). */
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

  const VERSION = '2026-11-15-studio-3';

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
      MAX_TAGS, MAX_CAPTION, MAX_CAPTION_WORDS, POSITIVE, LANG_TAGS,
      DEPTH_WORDS, DEPTH_BASE, STYLE_ATMOSPHERE, STYLE_ALIASES, resolveStyle, pickDepth,
      VOICE_IDENTITY, DEFAULT_VOICE_IDENTITY,
      layerOrder: ['anchor', 'voice', 'rhythm', 'space', 'arrangement', 'tail', 'guards'],
      captionOrder: ['genre', 'vocals', 'bpm', 'rhythm-section', 'instruments-roles', 'mix',
        'production', 'depth', 'arrangement', 'dynamics', 'mood', 'concept', 'guards'],
      tagOrder: ['genre', 'instruments', 'vocals', 'bpm', 'mood', 'era', 'production'],
      dictionaries: {
        GENRE_WORDS, RHYTHM_CHAR, RHYTHM_GROOVE, RHYTHM_KIT, RHYTHM_BY_GENRE, BASS_WORDS,
        VOCAL_GENDER, VOCAL_DELIVERY, VOCAL_TEXTURE, INSTRUMENT_WORDS, PROD_WORDS,
        PROD_BY_GENRE, PLACE_WORDS, DYNAMICS_WORDS, MOOD_WORDS, ERA_WORDS, CONCEPT_WORDS,
        ROLE_WORDS, MIX_WORDS, ARRANGEMENT_WORDS, GUARD_WORDS
      }
    }
  };
  if (typeof window !== 'undefined') window.BRIIX_MUSIC_BRAIN = globalThis.BRIIX_MUSIC_BRAIN;
})();
