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
    ['электро', 'edm'], ['r&b', 'r&b'],
    // Двуязычные ключи (точность черновиков, #45): строка наставника приходит
    // из чата по-английски — мозг обязан понимать английские жанры так же,
    // как русские задумки. Короткие латинские стемы (pop/rap/edm) ищутся на
    // границе слова (shortStem): «trap» не распадается на trap + rap,
    // «popular» не даёт жанр pop, «dream pop» не даёт отдельный pop.
    ['dream pop', 'dream pop'], ['dream-pop', 'dream pop'], ['shoegaze', 'dream pop'],
    ['soul', 'soul'], ['funk', 'funk'], ['pop', 'pop'], ['rock', 'rock'],
    ['house', 'house'], ['techno', 'techno'], ['hip-hop', 'hip-hop'], ['hip hop', 'hip-hop'],
    ['rap', 'rap'], ['lofi', 'lo-fi'], ['cinematic', 'cinematic'], ['orchestral', 'orchestral'],
    ['jazz', 'jazz'], ['ballad', 'ballad'], ['edm', 'edm'], ['synthwave', 'synthwave'],
    ['retrowave', 'synthwave'], ['trip-hop', 'trip-hop'], ['trip hop', 'trip-hop'],
    ['rnb', 'r&b'], ['folk', 'folk'], ['phonk', 'phonk'], ['indie rock', 'rock']
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
    ['разреженн', 'sparse'], ['разряженн', 'sparse'], ['рублен', 'chopped'],
    // английские ключи (двуязычные словари, #45)
    ['slow', 'slow'], ['fast', 'fast'], ['tight', 'tight'], ['dry', 'dry'], ['soft', 'soft'],
    ['live', 'live'], ['heavy', 'heavy'], ['broken', 'broken'], ['stuttering', 'stuttering'],
    ['straight', 'straight'], ['hypnotic', 'hypnotic'], ['rolling', 'rolling'],
    ['driving', 'driving'], ['bouncy', 'bouncy'], ['sparse', 'sparse'], ['chopped', 'chopped']
  ];
  const RHYTHM_GROOVE = [
    ['четыре четверти', 'four-on-the-floor kick groove'], ['four-on-the-floor', 'four-on-the-floor kick groove'],
    ['брейкбит', 'broken breakbeat'], ['драм-н-бейс', 'broken breakbeat'],
    ['брейк', 'breakbeat'], ['дроп', 'drop-led groove'], ['брейкдаун', 'breakdown groove'],
    ['вопрос-ответ', 'call-and-response drum pattern'],
    ['грув', 'drum groove'], ['ударн', 'drum groove'], ['барабан', 'drum groove'],
    ['бит', 'beat'], ['ритм', 'groove'], ['перкуссия', 'percussion groove'],
    ['пульс', 'steady pulse'], ['кик', 'kick-led groove'], ['снейр', 'snare-driven groove'],
    ['хэт', 'hi-hat pattern'], ['топот', 'stomping groove'], ['кача', 'swing groove'],
    // английские ключи: грув наставника читается без перевода
    ['four on the floor', 'four-on-the-floor kick groove'],
    ['breakbeat', 'breakbeat'], ['drum and bass', 'broken breakbeat'], ['dnb', 'broken breakbeat'],
    ['drums', 'drum groove'], ['drum', 'drum groove'], ['percussion', 'percussion groove'],
    ['pulse', 'steady pulse'], ['kick', 'kick-led groove'], ['snare', 'snare-driven groove'],
    ['swing', 'swing groove'], ['beats', 'beat'], ['beat', 'beat'], ['groove', 'drum groove']
  ];
  const RHYTHM_KIT = [
    ['кик + снейр', 'kick + snare'], ['кик и снейр', 'kick + snare'],
    ['kick + snare', 'kick + snare'], ['ride', 'ride cymbal'], ['райд', 'ride cymbal'],
    ['хэт', 'hi-hat'], ['том-том', 'toms'], ['томы', 'toms'], ['литавр', 'toms'], ['бонго', 'bongos'],
    ['конга', 'congas'], ['шейкер', 'shaker'], ['бубен', 'tambourine'],
    ['808', '808 kick'], ['909', '909 drums'], ['TR-909', '909 drums'],
    ['метёлк', 'brushed drums'], ['щёлк', 'finger snaps'], ['хлопк', 'claps'],
    // английские ключи кита
    ['hi-hat', 'hi-hat'], ['hihat', 'hi-hat'], ['toms', 'toms'], ['timpani', 'toms'],
    ['bongos', 'bongos'], ['congas', 'congas'], ['shaker', 'shaker'], ['tambourine', 'tambourine'],
    ['brushed', 'brushed drums'], ['brushes', 'brushed drums'], ['snaps', 'finger snaps'],
    ['finger snaps', 'finger snaps'], ['claps', 'claps']
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
    'orchestral': { char: 'slow', groove: 'orchestral pulse', kit: 'timpani + low strings' },
    // недостающие семейства (#45): профили обязаны покрывать все 23 семьи
    // STYLE_ATMOSPHERE — паритет ловит тест check-music-brain (секция 15)
    'funk': { char: 'tight', groove: 'syncopated funk groove', kit: 'kick + snare, tight hats' },
    'dream pop': { char: 'laid-back', groove: 'soft steady groove', kit: 'kick + snare, brushed hats' },
    'synthwave': { char: 'driving', groove: 'steady synth drum groove', kit: 'kick + snare, gated snare reverb' },
    'r&b': { char: 'smooth', groove: 'slow smooth groove', kit: 'kick + snare, crisp hats' }
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
    ['бас', 'bass'],
    // английские ключи низа
    ['sub bass', 'deep sub-bass'], ['sub-bass', 'deep sub-bass'], ['sub', 'deep sub-bass'],
    ['live bass', 'live bass guitar'], ['bass', 'bass']
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
    ['дуэт', 'duet vocals'], ['бэк-вокал', 'backing vocals'],
    // английские ключи: «female singer» больше не получает дефолт «male vocals»
    // (раньше спасала случайность — подстрока «male vocals» внутри «female
    // vocals»; скажи наставник «female singer», и в модель уезжало противоречие)
    ['female vocals', 'female vocals'], ['female vocal', 'female vocals'], ['female singer', 'female vocals'],
    ['female voice', 'female vocals'], ['girl vocals', 'female vocals'],
    ['male vocals', 'male vocals'], ['male vocal', 'male vocals'], ['male singer', 'male vocals'],
    ['male voice', 'male vocals'], ['baritone', 'male baritone'], ['tenor', 'male tenor'],
    ['choir', 'choir'], ['duet', 'duet vocals'], ['backing vocals', 'backing vocals'],
    ['bass voice', 'deep bass voice'], ['deep voice', 'deep bass voice'], ['low voice', 'deep male voice'],
    ['deep male voice', 'deep bass voice']
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
    ['нежн', 'tender delivery'],
    // английские ключи подачи
    ['whisper', 'whispered delivery'], ['whispered', 'whispered delivery'],
    ['half-whisper', 'half-whispered delivery'], ['spoken', 'spoken word'],
    ['chant', 'chanted delivery'], ['scream', 'screamed delivery'], ['shout', 'screamed delivery'],
    ['croon', 'crooned delivery'], ['intimate', 'intimate delivery'],
    ['confessional', 'confessional delivery'], ['detached', 'detached delivery'],
    ['tender', 'tender delivery'], ['full voice', 'full-voice delivery']
  ];
  const VOCAL_TEXTURE = [
    ['хрип', 'hoarse rasp'], ['хрипл', 'hoarse rasp'], ['гравий', 'gravel texture'],
    ['gravel', 'gravel texture'], ['бархат', 'velvet tone'], ['бархатн', 'velvet tone'],
    ['придыхан', 'breathy tone'], ['дыхан', 'breathy tone'], ['шершав', 'rough texture'],
    ['фальцет', 'falsetto'], ['falsetto', 'falsetto'], ['грудн', 'chest voice'],
    ['чист', 'clean tone'], ['тёпл', 'warm timbre'], ['тепл', 'warm timbre'],
    ['стеклянн', 'glassy timbre'], ['глух', 'muffled tone'],
    // английские ключи фактуры
    ['hoarse', 'hoarse rasp'], ['rasp', 'hoarse rasp'], ['velvet', 'velvet tone'],
    ['breathy', 'breathy tone'], ['breath', 'breathy tone'], ['rough', 'rough texture'],
    ['chest voice', 'chest voice'], ['glassy', 'glassy timbre'], ['muffled', 'muffled tone'],
    ['warm timbre', 'warm timbre'], ['warm voice', 'warm timbre']
  ];
  // Антифальцетный страж: «глубокий голос» обязан остаться в грудном регистре.
  // Негатив «без фальцета» перефразируется позитивно (model-acestep.md).
  const LOW_VOICE_HINTS = ['глубок', 'низк', 'бас', 'баритон', 'брутальн', 'грудн', 'мужск',
    'deep voice', 'bass voice', 'low voice', 'baritone', 'deep male'];
  // Голос — это идентичность, а не переменная. Пока о поле не сказано, в caption
  // уходило голое «vocals», и модель на каждой генерации бросала монетку:
  // мужской/женский без всякой зависимости от трека (владелец услышал это на
  // прогоне 15.11). Теперь пол выбирается детерминированно, в порядке
  // задумка → профиль слушателя → дефолт канала, и источник виден в notes.
  const VOICE_IDENTITY = { male: 'male vocals', female: 'female vocals' };
  const DEFAULT_VOICE_IDENTITY = 'male';
  const IDENTITY_RE = /female|male|baritone|tenor|bass voice|choir|duet/i;

  /* ===== VOCAL PROFILE VOCABULARY (audits/vocal-profile-vocabulary.md, 22.11) =====
   *
   * Голос задаётся ХАРАКТЕРИСТИКАМИ по семи осям, а не именами артистов
   * (#109: имена не попадают в caption никогда — утечки ловит styleLeaks).
   * Оси 1/3/4 наследуют боевые словари VOCAL_GENDER / VOCAL_TEXTURE /
   * VOCAL_DELIVERY: тот же вход, но теперь видно, КАКАЯ ось затронута, —
   * перекрытие семейного профиля идёт по осям (правило 2 справки), а не
   * «всё сразу» или «ничего». */
  const VOCAL_AXIS_ORDER = ['who', 'register', 'timbre', 'power', 'technique', 'character', 'processing'];
  const VOCAL_AXIS_WORDS = {
    // ось 1 «кто поёт» — пол и идентичность (VOCAL_GENDER) + возраст
    who: VOCAL_GENDER.concat([
      ['девушк', 'young female vocals'], ['юна', 'young female vocals'], ['юный', 'young male vocals'],
      ['young girl', 'young female vocals'], ['young female', 'young female vocals'],
      ['young male', 'young male vocals'], ['boyish', 'boyish male vocals'],
      ['mature man', 'mature male vocals'], ['mature male', 'mature male vocals'],
      ['child', 'child-like vocals'], ['детск', 'child-like vocals'], ['ребён', 'child-like vocals']
    ]),
    // ось 2 «регистр» — сопрано/альт/тенор/баритон/бас
    register: [
      ['сопрано', 'soprano'], ['soprano', 'soprano'], ['альт', 'alto'], ['alto', 'alto'],
      ['высокий голос', 'high-pitched vocals'], ['high-pitched', 'high-pitched vocals'],
      ['тонкий голос', 'thin vocals'], ['тенор', 'male tenor'], ['tenor', 'male tenor'],
      ['баритон', 'male baritone'], ['baritone', 'male baritone'],
      ['низкий голос', 'deep male voice'], ['бас-голос', 'deep bass voice'],
      ['deep bass voice', 'deep bass voice'], ['низкий вокал', 'deep male voice']
    ],
    // ось 3 «тембр» — фактура голоса (VOCAL_TEXTURE) + яркость/гладкость/нос
    timbre: VOCAL_TEXTURE.concat([
      ['bright vocal', 'bright timbre'], ['bright voice', 'bright timbre'], ['bright timbre', 'bright timbre'],
      ['гнусав', 'nasal timbre'], ['nasal', 'nasal timbre'],
      ['smooth vocal', 'smooth timbre'], ['smooth voice', 'smooth timbre'], ['smooth timbre', 'smooth timbre'],
      ['thin vocal', 'thin vocals'], ['тонкий вокал', 'thin vocals'],
      ['thick midrange', 'thick midrange timbre']
    ]),
    // ось 4 «мощь / подача» — как поёт (VOCAL_DELIVERY) + мощь и агрессия
    power: VOCAL_DELIVERY.concat([
      ['powerful', 'powerful belting'], ['belting', 'powerful belting'],
      ['aggressive vocal', 'gritty aggressive delivery'], ['gritty', 'gritty aggressive delivery'],
      ['брутальн', 'gritty aggressive delivery'],
      ['laid-back', 'laid-back delivery'], ['расслабленн', 'laid-back delivery'],
      ['shouted', 'shouted delivery'], ['на крик', 'shouted delivery']
    ]),
    // ось 5 «техника» — рык/скрим/вибрато/стаккато/фразировка
    technique: [
      ['рык', 'growl'], ['growl', 'growl'], ['скрим', 'screamo'], ['screamo', 'screamo'],
      ['припев на крик', 'sung-to-shouted chorus'], ['sung-to-shouted', 'sung-to-shouted chorus'],
      ['вибрат', 'wide vibrato'], ['vibrato', 'wide vibrato'],
      ['стаккато', 'staccato punchy phrasing'], ['staccato', 'staccato punchy phrasing'],
      ['melodic phrasing', 'melodic pop phrasing'], ['pop phrasing', 'melodic pop phrasing'],
      ['речитатив', 'spoken word'], ['spoken word', 'spoken word'],
      ['spoken-word', 'confident spoken-word flow']
    ],
    // ось 6 «характер» — настроение подачи
    character: [
      ['весёл', 'cheerful'], ['весел', 'cheerful'], ['cheerful', 'cheerful'],
      ['игрив', 'playful'], ['playful', 'playful'], ['дерзк', 'confident'], ['confident', 'confident'],
      ['злой голос', 'menacing'], ['menacing', 'menacing'], ['угрюм', 'menacing'],
      ['тосклив', 'melancholic'], ['melancholic vocal', 'melancholic'],
      ['соблазн', 'seductive'], ['seductive', 'seductive'],
      ['героич', 'heroic'], ['heroic', 'heroic'], ['swagger', 'casual swagger']
    ],
    // ось 7 «обработка» — как голос записан
    processing: [
      ['сухой вокал', 'dry upfront vocal'], ['dry vocal', 'dry upfront vocal'], ['dry upfront', 'dry upfront vocal'],
      ['двойной вокал', 'doubled vocals'], ['doubled vocal', 'doubled vocals'], ['дублирован', 'doubled vocals'],
      ['хором', 'layered harmonies'], ['подпевки', 'layered harmonies'],
      ['layered harmon', 'layered harmonies'], ['backing harmon', 'layered harmonies'],
      ['с эхо', 'wide reverb vocal'], ['эхо на голос', 'wide reverb vocal'],
      ['wide reverb vocal', 'wide reverb vocal'], ['reverb vocal', 'wide reverb vocal'],
      ['автотюн', 'autotune-light polish'], ['autotune', 'autotune-light polish'],
      ['radio-polished', 'radio-polished'], ['студийный голос', 'radio-polished'], ['radio polish', 'radio-polished']
    ]
  };
  // Ключи, которые лазят в чужие смыслы без контекста голоса: «мощный бас» —
  // это не belting, «звонкий бубенец» — не тембр вокала. Срабатывают только
  // когда в задумке назван голос (тот же приём, что у LOW_VOICE_HINTS).
  const GUARDED_AXIS_WORDS = {
    who: [['взросл', 'mature vocals']],
    power: [['мощн', 'powerful belting'], ['ленив', 'laid-back delivery'], ['агрессивн', 'gritty aggressive delivery']],
    timbre: [['звонк', 'bright timbre'], ['гладк', 'smooth timbre']],
    character: [['угрюм', 'menacing']]
  };
  /* Семейные профили голоса: готовый блок по осям для всех 23 семей
   * STYLE_ATMOSPHERE (паритет проверяет check-music-brain, секция 16).
   * Источник — §2 справки (проверенные кейсы координатора: евроданс, металл,
   * европоп, баллада, девичий поп, рэп, ретро-диско) + остальные семьи в той
   * же лексике. Профили чистые — без взаимоисключающих токенов (правило 3);
   * mood — семейный дефолт настроения вместо generic-«atmospheric» (§5).
   *
   * ПРАВИЛО 0 ВЛАДЕЛЬЦА (vocal-profile-vocabulary.md, 22.11): тонкие мужские
   * голоса запрещены — в мужских профилях НИКОГДА нет thin/light/breathy/
   * high tenor/falsetto, только chest/full/warm/wide chesty; при сомнении —
   * ниже и тяжелее. На женские профили не распространяется.
   *
   * guard — запреты противоположного регистра (Brain Upgrade Spec §3.3):
   * одного описания «низкий бас» мало, модель тянет припевы в фальцет;
   * проверенная на стене формулировка — «staying in the basement throughout,
   * no falsetto and no high-pitched screaming ever». Запрет снимается, если
   * автор ЯВНО попросил запрещённое (правило 2 — приоритет запроса). */
  const GUARD_LOW_MALE = 'staying in the basement throughout, no falsetto and no high-pitched screaming ever';
  const GUARD_MALE = 'chest register throughout, no falsetto';
  const GUARD_FEMALE = 'no male growl, staying in her register';
  const GUARD_CHOIR = 'no growl, choral register throughout';
  const VOCAL_PROFILES = {
    'psychedelic soul': { who: ['male vocals'], register: ['warm baritone'], timbre: ['warm timbre'],
      power: ['laid-back delivery'], processing: ['dry upfront vocal'], guard: [GUARD_MALE], mood: 'psychedelic' },
    'soul': { who: ['female vocals'], register: ['alto'], timbre: ['warm timbre'],
      power: ['powerful belting'], technique: ['wide vibrato'], processing: ['close-mic dry vocal'], guard: [GUARD_FEMALE], mood: 'emotional' },
    'funk': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'],
      technique: ['staccato punchy phrasing'], character: ['playful'], processing: ['dry upfront vocal'], guard: [GUARD_MALE], mood: 'euphoric' },
    'dream pop': { who: ['young female vocals'], timbre: ['breathy tone'], power: ['fragile intimate delivery'],
      processing: ['wide reverb vocal'], guard: [GUARD_FEMALE], mood: 'dreamy' },
    'pop': { who: ['young female vocals'], register: ['soprano'], timbre: ['bright timbre'],
      power: ['confident delivery'], technique: ['melodic pop phrasing'], processing: ['radio-polished'], guard: [GUARD_FEMALE], mood: 'euphoric' },
    'rock': { who: ['male vocals'], register: ['gritty baritone'], timbre: ['thick midrange timbre'],
      power: ['raspy aggressive delivery'], technique: ['sung verses shouted into a full-throated chorus'],
      processing: ['punchy upfront vocal'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
    'techno': { who: ['female vocals'], timbre: ['thin vocals'], power: ['detached delivery'],
      processing: ['dry upfront vocal'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
    'tech house': { who: ['male vocals'], timbre: ['chest voice'], power: ['spoken-sung'],
      processing: ['dry upfront vocal'], guard: [GUARD_LOW_MALE], mood: 'hypnotic' },
    'house': { who: ['soulful female vocals'], timbre: ['bright timbre'], power: ['confident delivery'],
      technique: ['melodic pop phrasing'], processing: ['wide reverb vocal'], guard: [GUARD_FEMALE], mood: 'euphoric' },
    'trap': { who: ['young male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], technique: ['staccato punchy phrasing'],
      processing: ['autotune-light polish'], character: ['confident'], guard: [GUARD_LOW_MALE], mood: 'dark' },
    'rap': { who: ['male vocals'], timbre: ['chest voice'], power: ['confident spoken-word flow'], technique: ['rhythmic staccato phrasing'],
      character: ['casual swagger'], processing: ['dry upfront vocal'], guard: [GUARD_LOW_MALE], mood: 'urban' },
    'hip-hop': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back spoken-word flow'],
      technique: ['staccato punchy phrasing'], processing: ['dry upfront vocal'], guard: [GUARD_LOW_MALE], mood: 'urban' },
    'lo-fi': { who: ['female vocals'], timbre: ['muffled tone'], power: ['intimate delivery'],
      processing: ['dry upfront vocal'], guard: [GUARD_FEMALE], mood: 'nostalgic' },
    'ambient': { who: ['female vocals'], timbre: ['breathy tone'], power: ['laid-back delivery'],
      processing: ['wide reverb vocal'], guard: [GUARD_FEMALE], mood: 'meditative' },
    'cinematic': { who: ['choir'], timbre: ['warm timbre'], power: ['stately delivery'],
      processing: ['wide reverb vocal'], guard: [GUARD_CHOIR], mood: 'cinematic' },
    'orchestral': { who: ['choir'], timbre: ['warm timbre'], power: ['stately delivery'],
      processing: ['wide reverb vocal'], guard: [GUARD_CHOIR], mood: 'anthemic' },
    'jazz': { who: ['female vocals'], register: ['alto'], timbre: ['warm timbre'],
      power: ['laid-back delivery'], technique: ['wide vibrato'], processing: ['close-mic dry vocal'], guard: [GUARD_FEMALE], mood: 'nostalgic' },
    'ballad': { who: ['mature male vocals'], timbre: ['warm timbre'], power: ['intimate soft delivery'],
      technique: ['melodic pop phrasing'], processing: ['close-mic dry vocal'], guard: [GUARD_MALE], mood: 'emotional' },
    'edm': { who: ['young male vocals'], register: ['full chesty tenor'], timbre: ['warm timbre'],
      power: ['playful cheerful delivery'], technique: ['melodic pop phrasing'], processing: ['dry upfront vocal'],
      guard: [GUARD_MALE], mood: 'euphoric' },
    'synthwave': { who: ['male vocals'], register: ['mid-register lead'], timbre: ['warm timbre'],
      power: ['confident delivery'], technique: ['melodic pop phrasing'],
      character: ['confident'], processing: ['layered harmonies', 'wide reverb vocal'], guard: [GUARD_MALE], mood: 'nostalgic' },
    'trip-hop': { who: ['female vocals'], timbre: ['breathy tone'], power: ['laid-back delivery'],
      processing: ['wide reverb vocal'], guard: [GUARD_FEMALE], mood: 'haunting' },
    'r&b': { who: ['female vocals'], timbre: ['velvet tone'], power: ['soft intimate delivery'],
      technique: ['melodic pop phrasing'], processing: ['layered harmonies'], guard: [GUARD_FEMALE], mood: 'sensual' },
    'folk': { who: ['male vocals'], timbre: ['warm timbre'], power: ['plain intimate delivery'],
      processing: ['close-mic dry vocal'], guard: [GUARD_MALE], mood: 'warm' }
  };
  // Взаимоисключающие пары (правило 3 справки: raspy + smooth, growl + breathy).
  // При конфликте семейный токен уступает авторскому — приоритет запроса (правило 2).
  const VOCAL_CONTRA_PAIRS = [
    [/(?:hoarse rasp|gravel|rough texture|growl|screamo|scream|shout|rasp|gritty|aggressive)/i,
     /(?:smooth|clean tone|velvet|polished|soft|tender|delicate)/i],
    [/(?:growl|screamo|scream|shout|gritty|aggressive|powerful belting|full-voice)/i,
     /(?:breathy|whisper|half-whisper|intimate|soft|tender|fragile)/i]
  ];
  function dropContradictory(familyTokens, userTokens) {
    const user = (userTokens || []).join(' ');
    return (familyTokens || []).filter(t => !VOCAL_CONTRA_PAIRS.some(([rough, soft]) =>
      (rough.test(t) && soft.test(user)) || (soft.test(t) && rough.test(user))));
  }
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
    ['ф-но', 'piano'], ['родес', 'Fender Rhodes'],
    // английские ключи инструментов (organ ≠ organic — граница слова в shortStem)
    ['acoustic guitar', 'acoustic guitar'], ['electric guitar', 'electric guitar'],
    ['guitar', 'guitar'], ['guitar solo', 'guitar'], ['guitars', 'guitar'],
    ['piano', 'piano'], ['pianos', 'piano'], ['grand piano', 'piano'],
    ['keys', 'keys'], ['keyboard', 'keys'], ['organ', 'organ'], ['hammond', 'organ'],
    ['saxophone', 'saxophone'], ['sax', 'saxophone'], ['strings', 'strings'],
    ['violin', 'strings'], ['cello', 'cello'], ['cellos', 'cello'],
    ['upright bass', 'upright bass'], ['double bass', 'upright bass'], ['bass', 'bass'],
    ['synth', 'synth'], ['synthesizer', 'synth'], ['accordion', 'accordion'],
    ['pads', 'pads'], ['pad', 'pads'], ['flute', 'flute'], ['flutes', 'flute'],
    ['trumpet', 'brass'], ['brass', 'brass'], ['rhodes', 'Fender Rhodes']
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
    ['дрожание скорости', 'wow and flutter'],
    // английские ключи продакшн-цепочки
    ['vinyl', 'vinyl crackle'], ['tape', 'tape saturation'], ['analog', 'analog warmth'],
    ['analogue', 'analog warmth'], ['cassette', 'tape saturation'],
    ['live room', 'live room sound'], ['live recording', 'live room sound'],
    ['dry', 'dry close-mic production'], ['tight', 'tight mix'], ['wide', 'wide stereo image'],
    ['warm', 'analog warmth'], ['warmth', 'analog warmth'],
    ['am radio', 'AM radio broadcast texture'], ['radio', 'AM radio broadcast texture'],
    ['reverb', 'deep reverb space'], ['compressed', 'compressed vocal level'],
    ['echo', 'tape echo'], ['reverse tape', 'reverse tape textures'],
    ['wow and flutter', 'wow and flutter'], ['sidechain', 'sidechained pads']
  ];
  // Атмосфера — «что слышно вокруг»: отдельный блок, не продакшн-цепочка.
  const ATMOS_WORDS = [
    ['дожд', 'rain atmosphere'], ['ночной город', 'night city'], ['пустын', 'desert air'],
    ['космос', 'space ambience'], ['кафе', 'cafe ambience'], ['склад', 'warehouse air'],
    ['помех', 'radio static'], ['туман', 'foggy room tone'], ['море', 'sea in the low end'],
    ['ветер', 'wind texture'], ['толп', 'crowd noise'], ['комнатная тишин', 'room silence'],
    // английские ключи атмосферы
    ['rain', 'rain atmosphere'], ['night city', 'night city'], ['desert', 'desert air'],
    ['space', 'space ambience'], ['cafe', 'cafe ambience'], ['café', 'cafe ambience'],
    ['warehouse', 'warehouse air'], ['static', 'radio static'], ['fog', 'foggy room tone'],
    ['foggy', 'foggy room tone'], ['sea', 'sea in the low end'], ['wind', 'wind texture'],
    ['crowd', 'crowd noise']
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
    'edm': ['clean modern production', 'tight low end'],
    // недостающие семейства (#45): паритет с STYLE_ATMOSPHERE ловит тест
    'rap': ['clean modern production', 'dry vocal up front'],
    'trip-hop': ['tape saturation', 'dub delay space'],
    'folk': ['intimate room sound', 'natural dynamics'],
    'orchestral': ['wide hall mix', 'natural dynamics'],
    'funk': ['live room sound', 'punchy low end'],
    'dream pop': ['reverb-drenched mix', 'soft focus production'],
    'synthwave': ['analog synth production', 'wide stereo mix'],
    'r&b': ['clean modern production', 'silky top end']
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
    ['карман', 'bass locked in the pocket with the kick'],
    // английские ключи глубины
    ['depth', 'front-to-back depth'], ['spacious', 'wide reverberant space'],
    ['echo', 'tape echo'], ['reverb', 'plate reverb tail'], ['close', 'close perspective'],
    ['distant', 'distant perspective'], ['room', 'room sound'], ['hall', 'hall ambience'],
    ['air', 'air between instruments'], ['atmospheric', 'atmospheric depth'],
    ['immersive', 'immersive depth'], ['mono', 'mono centre'],
    ['pocket', 'bass locked in the pocket with the kick']
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
    'шансон': 'folk', 'industrial': 'techno', 'trance': 'edm', 'chanson': 'folk',
    // английские алиасы семей (#45): черновик наставника пишет их в draft.style
    'rnb': 'r&b', 'hip hop': 'hip-hop', 'hiphop': 'hip-hop', 'lofi': 'lo-fi',
    'dreampop': 'dream pop', 'synth-pop': 'synthwave', 'synthpop': 'synthwave',
    'retrowave': 'synthwave', 'downtempo': 'trip-hop'
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
    ['порт ', 'harbour studio'], ['порт,', 'harbour studio'], ['в порту', 'harbour studio'],
    // английские ключи места записи
    ['basement', 'basement studio'], ['warehouse', 'waterfront warehouse studio'],
    ['studio', 'studio room tone'], ['live hall', 'live hall'], ['rooftop', 'rooftop'],
    ['roof', 'rooftop'], ['kitchen', 'kitchen recording'], ['radio', 'pirate radio studio'],
    ['coastal', 'coastal studio'], ['harbor', 'harbour studio'], ['harbour', 'harbour studio']
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
    ['без повтор', 'through-composed, evolving each section'],
    // английские ключи формы
    ['cold open', 'cold open on the groove'], ['first verse', 'sparse first verse'],
    ['second chorus', 'fuller second chorus'], ['fade out', 'fading outro'],
    ['fading', 'fading outro'], ['build', 'build into the last chorus'],
    ['no chorus', 'through-composed, no repeated chorus'],
    ['no repeats', 'through-composed, evolving each section']
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
    ['текстур', 'texture layer'], ['стаккато', 'staccato'],
    // английские ключи ролей
    ['lead', 'lead role'], ['main melody', 'carrying the main melody'],
    ['carries the melody', 'carrying the main melody'],
    ['carrying the main melody', 'carrying the main melody'], ['melodic', 'melodic'],
    ['bed', 'as a bed'], ['background', 'in the background'], ['texture', 'texture layer']
  ];
  // Русская половина микс-словаря; английские ключи доклеиваются ниже (concat),
  // чтобы словарь остался одним списком для scan и экспорта в правила.
  const MIX_WORDS_RU = [
    ['середин', 'present midrange'], ['верхн', 'open top end'],
    ['широк', 'wide stereo image'], ['глубин', 'front-to-back depth'],
    ['панч', 'punchy transients'], ['плотн', 'dense mix'],
    ['воздух', 'airy space around instruments'], ['сух', 'dry room']
  ];
  const MIX_WORDS = MIX_WORDS_RU.concat([
    // английские ключи микса — те же теги, что у русских слов
    ['midrange', 'present midrange'], ['top end', 'open top end'], ['wide', 'wide stereo image'],
    ['punchy', 'punchy transients'], ['dense', 'dense mix'], ['airy', 'airy space around instruments']
  ]);

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
    ['только живой', 'live instruments only'], ['только аналог', 'analog only'],
    // английские ключи защит (безударность — отдельно в NO_DRUMS/POSITIVE)
    ['no autotune', 'unprocessed natural voice'], ['no auto-tune', 'unprocessed natural voice'],
    ['no vocoder', 'unprocessed natural voice'], ['no distortion', 'clean tones'],
    ['no overdrive', 'clean tones'], ['no vibrato', 'straight-tone delivery'],
    ['analog only', 'analog only'], ['no snare', 'kick and hats only'],
    ['no claps', 'kick and snare only'], ['no drums', 'beatless drift'],
    ['no percussion', 'beatless drift'], ['no climax', 'flat dynamics, loop-like'],
    ['no reverb', 'dry close-mic production'], ['male only', 'male vocals only'],
    ['female only', 'female vocals only'], ['live instruments only', 'live instruments only']
  ];

  // TAIL — динамика, настроение, концепт.
  const DYNAMICS_WORDS = [
    ['волн', 'wave dynamics'], ['нарастан', 'slow build'], ['разгон', 'build'],
    ['почти-тишин', 'near-silent suspensions before drums re-enter'],
    ['почти тишин', 'near-silent suspensions before drums re-enter'],
    ['тишин', 'near-silent suspensions before drums re-enter'],
    ['сброс', 'drop'], ['затуха', 'fading outro'], ['раскачк', 'swelling dynamics'],
    ['постоянн', 'steady energy'], ['ровн', 'steady energy'],
    ['без кульминац', 'flat dynamics, loop-like'], ['без кульминаци', 'flat dynamics, loop-like'],
    // английские ключи динамики
    ['wave', 'wave dynamics'], ['slow build', 'slow build'], ['build up', 'build'],
    ['build', 'build'], ['silence', 'near-silent suspensions before drums re-enter'],
    ['fade', 'fading outro'], ['swell', 'swelling dynamics'], ['steady', 'steady energy']
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
    ['медитативн', 'meditative'], ['торжественн', 'anthemic'],
    // английские ключи настроения
    ['melancholic', 'melancholic'], ['melancholy', 'melancholic'], ['sad', 'melancholic'],
    ['nostalgic', 'nostalgic'], ['dark', 'dark'], ['hypnotic', 'hypnotic'],
    ['cinematic', 'cinematic'], ['dreamy', 'dreamy'], ['euphoric', 'euphoric'],
    ['uplifting', 'euphoric'], ['emotional', 'emotional'], ['romantic', 'emotional'],
    ['cold', 'cold'], ['ethereal', 'ethereal'], ['aggressive', 'aggressive'],
    ['haunting', 'haunting'], ['warm', 'warm'], ['warmth', 'warm'], ['urban', 'urban'],
    ['atmospheric', 'atmospheric'], ['psychedelic', 'psychedelic'], ['sensual', 'sensual'],
    ['surreal', 'surreal'], ['meditative', 'meditative'], ['anthemic', 'anthemic']
  ];
  const ERA_WORDS = [
    ['70-е', '70s'], ['70-х', '70s'], ['70х', '70s'], ['семидесят', '70s'], ['1970', '70s'],
    ['80-е', '80s'], ['80-х', '80s'], ['80х', '80s'], ['восьмидесят', '80s'], ['1980', '80s'],
    ['90-е', '90s'], ['90-х', '90s'], ['90х', '90s'], ['девяност', '90s'], ['1990', '90s'],
    // английские ключи эпохи (70s/80s/90s — граница слова: не внутри «1980s»)
    ['70s', '70s'], ['80s', '80s'], ['90s', '90s'], ['1970s', '70s'], ['1980s', '80s'], ['1990s', '90s'],
    ['seventies', '70s'], ['eighties', '80s'], ['nineties', '90s']
  ];
  // Концепт-строка: тема лирики как её назвал автор, без домыслов.
  const CONCEPT_WORDS = [
    ['ночной город', 'night city'], ['ночь', 'night'], ['город', 'city'],
    ['море', 'sea'], ['порт', 'harbour'], ['туман', 'fog'], ['дожд', 'rain'],
    ['дорог', 'road'], ['поезд', 'trains'], ['одиночеств', 'loneliness'],
    ['память', 'memory'], ['время', 'time'], ['свобод', 'freedom'],
    ['любов', 'love'], ['разлук', 'separation'], ['мечт', 'dreams'],
    ['страх', 'fear'], ['тишина', 'silence'], ['тишине', 'silence'], ['плёнк', 'tape'], ['пленк', 'tape'],
    ['радио', 'radio'], ['эфир', 'broadcast'], ['свет', 'light'], ['тьма', 'darkness'],
    // английские ключи концепта. Голого «dream» НЕТ и не будет: «dream pop»
    // затекал в концепты как «lyrics about dreams» — жанр ≠ тема лирики.
    ['night city', 'night city'], ['night', 'night'], ['city', 'city'], ['sea', 'sea'],
    ['ocean', 'sea'], ['harbour', 'harbour'], ['harbor', 'harbour'], ['fog', 'fog'],
    ['rain', 'rain'], ['road', 'road'], ['trains', 'trains'], ['train', 'trains'],
    ['loneliness', 'loneliness'], ['lonely', 'loneliness'], ['memory', 'memory'],
    ['time', 'time'], ['freedom', 'freedom'], ['love', 'love'], ['separation', 'separation'],
    ['dreams', 'dreams'], ['fear', 'fear'], ['silence', 'silence'], ['tape', 'tape'],
    ['radio', 'radio'], ['broadcast', 'broadcast'], ['light', 'light'], ['darkness', 'darkness']
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
    [/no\s+(lyrics|vocals)/i, 'instrumental'],
    // английские негативы «without …» (живой кейс: черновик наставника)
    [/without\s+reverb/i, 'dry close-mic production'],
    [/without\s+climax/i, 'flat dynamics, loop-like'],
    [/without\s+falsetto/i, 'full-voice delivery'],
    [/without\s+female/i, 'male vocals only'],
    [/without\s+male/i, 'female vocals only'],
    [/without\s+(?:words|vocals|lyrics)/i, 'instrumental']
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
  /* Короткий русский стем (≤3 букв) ищем только на границе слова слева: иначе
     «рок» ловится в «широкий», «поп» — в «попытка», «бит» — в «убитый».
     Короткий ЛАТИНСКИЙ стем (≤5) — на границе с ДВУХ сторон (#45): «pop» не
     ловится в «popular», «rap» — в «trap», «organ» — в «organic», «beat» —
     в «beatless». Длинные ключи ищутся подстрокой: «guitar» находит и «guitars». */
  const CYR = /[а-я0-9]/;
  const LAT = /[a-z0-9]/i;
  function shortStem(text, w, from) {
    if (!/[а-я]/.test(w) && w.length <= 5) {
      let idx = text.indexOf(w, from);
      while (idx >= 0) {
        const before = idx > 0 ? text[idx - 1] : '';
        const after = text[idx + w.length] || '';
        if (!LAT.test(before) && !LAT.test(after)) return idx;
        idx = text.indexOf(w, idx + 1);
      }
      return -1;
    }
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
      found.push({ from: word, tag, pos, len: norm(word).length });
    }
    // Хит-в-хите по ПОЗИЦИИ, а не по тегу (#45): «male vocals» целиком лежит
    // внутри «female vocals» и потому ложен. До сих пор противоречие съедал
    // дедуп подстрокой тега — но «female singer» без «vocals» получало
    // дефолтное «male vocals» рядом с женским вокалом. Хит, полностью лежащий
    // внутри другого хита, отбрасываем до фильтра тегов.
    const spans = found.filter(h => !found.some(o => o !== h && o.pos <= h.pos && h.pos + h.len <= o.pos + o.len));
    // Тег-в-теге внутри одного словаря: «bass»/«guitar» не должны съедать слоты
    // у «live bass guitar», если автор сказал «бас-гитара».
    const strict = spans.filter(h => !spans.some(o => o !== h && o.tag.includes(h.tag)));
    strict.sort((a, b) => a.pos - b.pos);
    return (max ? strict.slice(0, max) : strict).map(({ from, tag }) => ({ from, tag }));
  }

  const uniq = list => list.filter((v, i) => v && list.indexOf(v) === i);

  /* ------------------------------------------------------------ слои caption */

  // «без ударных» — позитивная переформулировка: не колотим drums, а описываем
  // безударный дрейф (негативов в caption не бывает, model-acestep.md).
  // Английские формы — «no drums», «without drums», «beatless», «drumless» —
  // раньше не ловились, и безударному эмбиенту доклеивался грув (#45).
  const NO_DRUMS = /без\s+(ударн|барабан|бит|перкусси)|(?:no|without)\s+(?:drums?|percussion|beat|drum\s+kit)|beatless|drumless/i;

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
      // Слово характера не повторяет грув, который уже начинается с него:
      // профиль рока {char:'live', groove:'live drum groove'} иначе давал
      // «live live drum groove».
      .filter(w => !grooveWord.startsWith(w + ' ') && grooveWord !== w)
      .sort((a, b) => CHAR_ORDER.indexOf(a) - CHAR_ORDER.indexOf(b));
    return {
      phrase: [[head.join(' '), grooveWord].filter(Boolean).join(' '), '(' + kit + ')'].join(' '),
      groove: grooveWord, kit, char: head.join(' '), from: { groove: grooveHit.map(h => h.from), kit: kitHit.map(h => h.from) }
    };
  }

  /* Голос по семи осям (vocal-profile-vocabulary.md): семейный профиль +
   * перекрытие затронутых осей словами автора (правило 2) + нейтраль, когда
   * семья не распознана и автор о голосе не сказал (правило 6). Идентичность
   * (задумка → профиль слушателя → дефолт канала) и антифальцетный страж
   * сохраняют прежнюю механику — они старше справки и проверены прогонами. */
  function pickVoice(text, options, style) {
    const isSong = options.kind === 'song';
    const gender = scan(text, VOCAL_GENDER, 2);
    const delivery = scan(text, VOCAL_DELIVERY, 2);
    const texture = scan(text, VOCAL_TEXTURE, 2);
    // Страж срабатывает только когда речь о голосе: «глубокий ритм» — не голос.
    const voiceWords = /(голос|вокал|поет|поёт|пени|баритон|шепот|шёпот|речитатив|подпев|voice|vocal|singer|\bsing|whisper|spoken)/.test(text);
    const lowRegister = gender.some(g => ['male baritone', 'deep bass voice', 'male vocals', 'male tenor'].includes(g.tag))
      || (voiceWords && LOW_VOICE_HINTS.some(w => text.includes(norm(w))));
    const falsettoAsked = !negated(text, 'фальцет') || !negated(text, 'falsetto');
    const antiFalsetto = lowRegister && !falsettoAsked;
    // Профиль слушателя: options.voiceIdentity = 'male' | 'female'.
    const identityKey = String(options.voiceIdentity || '').toLowerCase();
    const identityTag = VOICE_IDENTITY[identityKey] || VOICE_IDENTITY[DEFAULT_VOICE_IDENTITY];
    const identityFrom = identityKey && VOICE_IDENTITY[identityKey] ? 'профиль' : 'дефолт канала';

    // Семейный профиль голоса: есть семья → её оси становятся дефолтами.
    const familyKey = style && style.key && VOCAL_PROFILES[style.key] ? style.key : null;
    const familyProfile = familyKey ? VOCAL_PROFILES[familyKey] : null;
    // Скан по осям: базовые словари + ключи, требующие контекста голоса.
    const dictFor = axis => voiceWords
      ? VOCAL_AXIS_WORDS[axis].concat(GUARDED_AXIS_WORDS[axis] || [])
      : VOCAL_AXIS_WORDS[axis];
    const hits = {};
    for (const axis of VOCAL_AXIS_ORDER) hits[axis] = scan(text, dictFor(axis), 2).map(h => h.tag);

    // — ось 1 «кто поёт»: слова автора → профиль слушателя → семья → дефолт.
    // Названа только фактура («бэк-вокал») → идентичность лида всё равно
    // фиксируется, иначе пол поплывёт (прогон 15.11).
    const userWho = uniq(hits.who);
    const askedIdentity = userWho.some(t => IDENTITY_RE.test(t));
    const familyWho = familyProfile && (familyProfile.who || []).length ? familyProfile.who : [];
    let whoTokens = userWho.slice();
    if (!askedIdentity) {
      const identityFiller = identityFrom === 'профиль' || !familyWho.length ? [identityTag] : familyWho;
      whoTokens = whoTokens.concat(identityFiller);
    }
    // — остальные оси: автор перекрывает, семья дополняет (правило 2).
    const axes = { who: { tokens: uniq(whoTokens), source: userWho.length ? 'user' : (familyWho.length ? 'style' : 'identity') } };
    const userAxes = [];
    if (userWho.length) userAxes.push('who');
    for (const axis of VOCAL_AXIS_ORDER.slice(1)) {
      if (hits[axis].length) { axes[axis] = { tokens: uniq(hits[axis]), source: 'user' }; userAxes.push(axis); }
      else if (familyProfile && (familyProfile[axis] || []).length) axes[axis] = { tokens: familyProfile[axis].slice(), source: 'style' };
      else axes[axis] = { tokens: [], source: 'none' };
    }
    // — нейтраль (правило 6): семья не распознана и автор промолчал про
    // характерные оси — чистый сухой профиль вместо generic-хвоста
    // «intimate delivery», который раньше дописывался европопу и металлу alike.
    if (!familyProfile) {
      if (!axes.timbre.tokens.length) axes.timbre = { tokens: ['clean tone'], source: 'neutral' };
      if (!axes.processing.tokens.length) axes.processing = { tokens: ['dry upfront vocal'], source: 'neutral' };
    }
    // — противоречия (правило 3): семейный токен, конфликтующий с авторским
    // (raspy + smooth, growl + breathy), отбрасывается — приоритет запроса.
    const userAll = [];
    for (const axis of VOCAL_AXIS_ORDER) userAll.push(...hits[axis]);
    for (const axis of VOCAL_AXIS_ORDER) {
      if (axes[axis].source === 'style') axes[axis].tokens = dropContradictory(axes[axis].tokens, userAll);
    }
    // — запреты регистра (Brain Upgrade Spec §3.3): одного «низкого баса» мало,
    // модель тянет припевы в фальцет — семейный guard едет отдельным блоком
    // после голосового профиля. Запрет снимается, если автор ЯВНО попросил
    // запрещённое слово (фальцет/рык/высокий крик) — приоритет запроса (правило 2).
    const guardTokens = familyProfile && familyProfile.guard
      ? familyProfile.guard.filter(g => {
        const banned = [...g.matchAll(/no ([a-z-]+(?:\s[a-z-]+)?)/gi)]
          .flatMap(m => m[1].split(/\s+/)).filter(w => w.length >= 5);
        return !banned.some(w => userAll.some(u => u.toLowerCase().includes(w)));
      })
      : [];
    // — сборка блока в порядке осей 1–7; антифальцетный страж — в конец.
    let profileTokens = [];
    for (const axis of VOCAL_AXIS_ORDER) profileTokens = profileTokens.concat(axes[axis].tokens);
    if (antiFalsetto && !profileTokens.includes('falsetto')) profileTokens.push(FALSETTO_GUARD);
    // Назван регистр — голый пол избыточен («male vocals» рядом с «male baritone»).
    const hasRegister = profileTokens.some(t => /baritone|tenor|bass voice|soprano|alto|choir|duet/.test(t));
    if (hasRegister) profileTokens = profileTokens.filter(t => t !== 'male vocals' && t !== 'female vocals');
    // Бейдж происхождения голоса (правило 5): источник виден и честен.
    const styleAxes = VOCAL_AXIS_ORDER.filter(a => axes[a].source === 'style').length;
    const badgeSource = userAll.length ? (styleAxes ? 'mixed' : 'user') : (styleAxes ? 'style' : 'neutral');

    return {
      tags: uniq(profileTokens),
      genderTags: uniq(axes.who.tokens),
      characterTags: uniq(VOCAL_AXIS_ORDER.slice(1).flatMap(a => axes[a].tokens)),
      character: delivery.map(d => d.tag).concat(texture.map(t => t.tag)),
      antiFalsetto,
      identityTag: isSong && !askedIdentity ? identityTag : null,
      identityFrom: isSong && !askedIdentity ? identityFrom : 'задумка',
      axes,
      guard: guardTokens,
      profile: { source: badgeSource, userCount: userAll.length, family: familyKey },
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
    // Семейство стиля строит ВСЮ конструкцию, а не только глубину (#45): когда
    // жанровых слов в задумке нет, но резолвер дал семейство (draft.style из
    // черновика наставника/продюсера), оно становится якорем жанра — ритм и
    // продакшн едут по профилю семейства, а не по безликому фолбэку.
    const styleResolved = resolveStyle(genreTags, options);
    const anchorTags = genreTags.length ? genreTags : (styleResolved.key ? [styleResolved.key] : []);
    const primaryGenre = anchorTags[0] || null;

    const era = scan(text, ERA_WORDS, 1).map(e => e.tag);
    const mood = scan(text, MOOD_WORDS, 2).map(m => m.tag);
    // Дефолт настроения — семейный (§5 справки): у европопа и металла он
    // разный, generic-«atmospheric» всем подряд больше не дописывается.
    // Выбор автора в «Музыке» (options.mood) сильнее семьи.
    if (!mood.length) {
      const familyMood = styleResolved.key && VOCAL_PROFILES[styleResolved.key] ? VOCAL_PROFILES[styleResolved.key].mood : null;
      mood.push(FORM_MOOD[options.mood] || familyMood || 'atmospheric');
    }
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
    const depth = pickDepth(text, styleResolved, text);

    return {
      anchor: { genre: uniq(anchorTags), era },
      voice: isSong ? pickVoice(text, options, styleResolved) : { tags: [], character: [], from: {} },
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

    // Порядок блоков: голосовой профиль — ПЕРВЫМ (vocal-profile-vocabulary.md,
    // правило 1: модели весят начало строки выше), дальше формула корпуса
    // (жанр → BPM → ритм-секция → инструменты → продакшн → настроение → концепт).
    // Приоритет 1: бюджет голосовой блок не срезает никогда. Компактный бюджет
    // (≤300, legacy buildTags) ужимает блок умно: сначала уходят нейтральные
    // заполнители («clean tone» / «dry upfront vocal»), остаются три ведущих
    // токена; антифальцетный страж не режется никогда — это защита регистра.
    const compactVoice = list => {
      const guard = list.find(t => /register never rises/.test(t));
      let core = list.filter(t => t !== 'clean tone' && t !== 'dry upfront vocal').slice(0, 3);
      if (core.length < 2) core = list.slice(0, 3); // нейтраль без характерных осей — заполнители нужны
      return guard && !core.includes(guard) ? core.concat(guard) : core;
    };
    add('vocal.profile', budget <= 300 ? compactVoice(voice.tags || []) : (voice.tags || []), 1);
    // Запреты регистра (Brain Upgrade Spec §3.3): отдельный блок сразу за
    // голосовым профилем; приоритет 2 — под жёстким бюджетом уходит после
    // хвоста, но раньше глубины: защита регистра важнее пары планов.
    add('vocal.guard', budget <= 300 ? [] : (voice.guard || []), 2);
    if (options.kind === 'song') add('voice.language', [LANG_TAGS[options.language] || LANG_TAGS.en], 1);
    add('anchor.genre', anchor.genre, 1);
    if (layers.instrumental) add('instrumental', ['instrumental'], 1);
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
    if (layers.voice.profile) {
      const p = layers.voice.profile;
      const origin = p.source === 'style' ? 'семья «' + p.family + '»'
        : p.source === 'mixed' ? p.userCount + ' признак(ов) автора поверх семьи «' + p.family + '»'
        : p.source === 'user' ? p.userCount + ' признак(ов) автора'
        : 'нейтральный профиль (семья не распознана)';
      push('профиль голоса: ' + origin, 'голос', 'voice.profile');
    }
    (layers.voice.guard || []).forEach(t => push(t, 'защита регистра', 'vocal.guard'));
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

  /* Брекеты динамики v2 (audits/lyrics-effect-brackets.md + audits/dm-signatures.md,
   * Brain Upgrade Spec §4): второй канал описания — динамика ПО СЕКЦИЯМ живёт в
   * лирике, не в caption. Обогащение #47: стилевые профили брекетов (8 групп
   * семейств + нейтральный фолбэк), 7 слотов (intro / riser / contrast / space /
   * lift / solo / outro — категории §1: аранжировка, динамика, вокал,
   * пространство, соло), анти-дублирование с caption биграммами (§2.4),
   * норма плотности ≤6 на полный трек и 3–4 на короткий (§3). Все брекеты —
   * EN ASCII вне зависимости от языка лирики (§2.3), без дословных повторов;
   * выбор варианта — по хешу лирики+стиля (детерминизм для A/B-пар).
   * Наполнение synthwave-профиля — сигнатуры dm-signatures.md (brass stabs,
   * breathy choir, reverse reverb swell, twangy slide guitar, vinyl crackle). */
  const BRACKET_GROUPS = {
    'psychedelic soul': 'groove', 'soul': 'groove', 'funk': 'groove', 'r&b': 'groove',
    'dream pop': 'mellow', 'trip-hop': 'mellow', 'lo-fi': 'mellow', 'ambient': 'mellow',
    'pop': 'band', 'rock': 'band',
    'techno': 'club', 'tech house': 'club', 'house': 'club', 'edm': 'club',
    'synthwave': 'synth',
    'trap': 'urban', 'rap': 'urban', 'hip-hop': 'urban',
    'jazz': 'acoustic', 'folk': 'acoustic', 'ballad': 'acoustic',
    'cinematic': 'score', 'orchestral': 'score'
  };
  const BRACKETS_BY_GROUP = {
    club: { // techno / tech house / house / edm — клубная четырёхдольная динамика
      intro: ['filter slowly opening over kick', 'cold synth stabs, no kick yet', 'drums only, bass rumble underneath'],
      riser: ['snare roll building, riser swell', 'hi-hats doubling, tension rising', 'kick and claps building, filter rising'],
      contrast: ['drums drop out, bass only groove', 'breakdown to pads and clap echoes', 'kick mutes, percussion answers'],
      space: ['big room reverb on claps', 'wide stereo echo, vocal chops panning', 'tape saturation, warm hiss'],
      lift: ['full drop, layered synth stabs', 'double-time hats, bigger bass', 'key change up, wider synth stack'],
      solo: ['synth solo, filter opening wide', 'arpeggio cycling, drums dropping', 'drum fill into the drop'],
      outro: ['kick fades, pads and echo tail', 'elements peel away, filter closing', 'beat runs out, reverb tail only']
    },
    synth: { // synthwave — сигнатуры dm-signatures.md (без имён артистов)
      intro: ['cold arpeggiated synth, deep analog bass pulse', 'slow synth pads, vinyl noise, no drums', 'reverse reverb swell into the first beat'],
      riser: ['filtered drums slowly rising', 'rising pads, gated snare building', 'arpeggio accelerating, slow build'],
      contrast: ['drums drop out, sparse analog bass', 'no drums, arpeggio and whisper vocal', 'bass and drums only, minimal pads'],
      space: ['cathedral reverb on the snare', 'wide stereo echo, distant counter-vocal', 'tape saturation, warm analog hiss'],
      lift: ['gated snare, brass stabs, low harmonies', 'full drums, octave-doubled vocals', 'choir pad doubles the harmony, wider'],
      solo: ['twangy guitar solo with slap delay', 'moody synth solo, gliding lead', 'organ swell solo over arpeggio'],
      outro: ['instruments peel away, pads and tape hiss', 'cold arpeggio fading, bass pulse slowing', 'vinyl crackle, slow fade to hiss']
    },
    urban: { // trap / rap / hip-hop — битовое дыхание и адлибы
      intro: ['808 rumble, vinyl crackle, no drums', 'filtered sample loop, hats whisper', 'ad-libs echoing, beat about to drop'],
      riser: ['riser swell and snare roll', 'hats speeding up, 808 swelling', 'beat stripped to kick, claps rising'],
      contrast: ['beat cuts out, a cappella line', 'drums drop, 808 and vocal only', 'sample chops answer the vocal'],
      space: ['wide stereo echo on ad-libs', 'half-time feel, big reverb on the clap', 'tape saturation, dusty loop hiss'],
      lift: ['gang vocals, double-time hats, 808 slides', 'full beat returns, layered ad-libs', 'key change up, choir pads behind'],
      solo: ['beat-only break, scratch fills', '808 gliding alone, bass solo', 'hat rolls and drum fill'],
      outro: ['beat fades, vinyl crackle remains', '808 tail rings out, echo on the last line', 'hats fade, sample loops alone']
    },
    band: { // rock / pop — живая группа
      intro: ['clean guitar riff, kick counting in', 'drums only build into the riff', 'acoustic strum, room mics opening'],
      riser: ['floor tom build, cymbal swell', 'guitars opening up, slow build', 'snare rolls rising into the chorus'],
      contrast: ['drums drop out, bass and guitar only', 'stripped to piano and vocal', 'breakdown to a whisper, then tension'],
      space: ['cathedral reverb on the last line', 'wide stereo echo, distant answer vocal', 'tape saturation, warm room hiss'],
      lift: ['bigger harmonies, double tempo drums', 'full-band lift, gang vocals', 'key change up, wider harmonies'],
      solo: ['guitar solo, wide-vibrato lead', 'instrumental break, organ and riff', 'drum fill into the last chorus'],
      outro: ['instruments peel away, last chord rings', 'riff slows, feedback fading', 'acoustic strum to silence']
    },
    groove: { // psychedelic soul / soul / funk / r&b — духовые и грув
      intro: ['horn stabs, hi-hat counting in', 'bass and clav riff, no drums', 'wah guitar licks, congas whispering'],
      riser: ['congas building, horns swelling', 'organ riser, drums opening up', 'tambourine rising into the chorus'],
      contrast: ['drums drop out, bass and clav only', 'breakdown to handclaps and vocal', 'horns drop out, guitar answers alone'],
      space: ['wide stereo echo on the horn line', 'vintage plate reverb on the vocal', 'tape saturation, warm analog hiss'],
      lift: ['full horn section, gang vocals', 'key change up, stacked harmonies', 'double-time groove, tambourine, wider stack'],
      solo: ['sax solo, breathy and wide', 'clav solo over the breakdown', 'bass solo with popping fills'],
      outro: ['horns fade, groove rides out', 'band peels away, congas and ad-libs', 'vamp fades, handclaps to the end']
    },
    mellow: { // dream pop / trip-hop / lo-fi / ambient — дым и текстура
      intro: ['hazy pads, vinyl crackle, no drums', 'soft guitar arpeggio, tape hiss', 'distant piano, room tone only'],
      riser: ['filtered drums slowly rising', 'pads swelling, snare softly building', 'slow build, textures stacking'],
      contrast: ['drums drop out, bass and pad only', 'breakdown to a whisper vocal', 'beat mutes, keys answer alone'],
      space: ['cathedral reverb tail, washy guitars', 'wide stereo echo, voice doubled far', 'tape saturation, warm hiss, wow and flutter'],
      lift: ['bigger harmonies, drums opening wide', 'wall of sound, wider stack', 'key change up, layered vocal haze'],
      solo: ['dreamy guitar solo, tremolo drift', 'instrumental break, mellotron pad', 'piano break over vinyl crackle'],
      outro: ['pads and hiss fading to silence', 'instruments dissolve, echo remains', 'tape stops, room tone alone']
    },
    acoustic: { // jazz / folk / ballad — камерная динамика
      intro: ['brushes on snare, upright bass walking', 'piano intro, soft room reverb', 'fingerpicked guitar, warm and close'],
      riser: ['brushes swelling, piano rising', 'strings entering softly, slow build', 'hushed snare roll, crescendo into chorus'],
      contrast: ['drums drop out, bass and piano only', 'strings enter, voice alone with them', 'breakdown to voice and guitar'],
      space: ['hall reverb on the vocal tail', 'wide stereo echo, distant strings answer', 'tape saturation, warm analog hiss'],
      lift: ['strings soar, bigger harmonies', 'full ensemble, key change up', 'crescendo, choir answers the lead'],
      solo: ['sax solo, warm and smoky', 'piano solo, sparse and late-night', 'upright bass solo, brushes behind'],
      outro: ['ensemble fades to piano alone', 'last chord rings, hall tail lingering', 'guitar slows to a whispered end']
    },
    score: { // cinematic / orchestral — кинематографические волны
      intro: ['low strings swell, timpani roll', 'solo piano over a string pad', 'distant choir, hall ambience only'],
      riser: ['timpani and strings rising', 'crescendo build, brass entering', 'harp glissando into the chorus'],
      contrast: ['ensemble drops to solo cello', 'strings only, percussion silent', 'breakdown to voice and piano'],
      space: ['cathedral choir reverb tail', 'wide hall echo, distant brass answer', 'sudden stop, one heartbeat pulse'],
      lift: ['full orchestra, cymbals, key change up', 'choir and brass together, biggest dynamics', 'crescendo to fortissimo, timpani rolls'],
      solo: ['violin solo over the strings', 'oboe solo, distant and clear', 'piano cadenza, orchestra silent'],
      outro: ['orchestra fades to strings alone', 'instruments peel away, hall tail remains', 'final chord decays to silence']
    }
  };
  const BRACKETS_GENERIC = { // нейтральный профиль — семейство не определено
    intro: ['drums only build, atmosphere entering', 'bass groove alone, no melody yet', 'texture pad, filter slowly opening'],
    riser: ['filtered drums slowly rising', 'slow build, riser swell', 'percussion building, tension rising'],
    contrast: ['drums drop out, sparse bass', 'strings enter, bass only', 'breakdown to a whisper'],
    space: ['cathedral reverb tail', 'wide stereo echo, distant answer', 'tape saturation, warm hiss'],
    lift: ['bigger harmonies, double tempo drums', 'key change up, wider harmonies', 'full-band lift, gang vocals'],
    solo: ['instrumental break, lead takes over', 'guitar solo, expressive lead', 'synth solo, filter opening'],
    outro: ['instruments peel away, slow fade', 'beat fades, echo tail remains', 'elements dissolve to silence']
  };
  const BRACKET_SLOTS = ['intro', 'riser', 'contrast', 'space', 'lift', 'solo', 'outro'];
  const SECTION_LINE_RE = /^\[([A-Za-z][^\]\n]{0,60})\]$/;
  // Биграммы текста — для анти-дублирования брекетов с caption (§2.4): брекет
  // описывает ИЗМЕНЕНИЕ во времени и не должен повторять слой caption дословно
  // (одно общее слово «drums» допустимо — «gated snare drops out» это изменение).
  function bracketBigrams(s) {
    const w = String(s || '').toLowerCase().match(/[a-z]+/g) || [];
    const set = new Set();
    for (let i = 0; i + 1 < w.length; i++) set.add(w[i] + ' ' + w[i + 1]);
    return set;
  }

  /* Семейство стиля из свободного текста (идея/caption) — общий резолв для
   * разметки брекетов (#47) и атмосферного направления автолирики (#48):
   * явная подсказка style сильнее, иначе — жанровые слова текста. */
  function styleOf(text, options = {}) {
    return resolveStyle(
      scan(String(text || ''), GENRE_WORDS, 2).map(g => g.tag),
      options).key;
  }

  function markLyricsDynamics(lyrics, options) {
    const opts = options || {};
    const text = String(lyrics || '');
    const none = { lyrics: text, marked: 0, authored: 0, style: null };
    if (!text.trim()) return none;
    // Автор уже размечал эффекты? ([Chorus: layered harmonies] — двоеточие
    // внутри тега.) Тогда лирика идёт в модель как есть — мозг не дописывает.
    const authored = text.match(/\[[^\]\n]+:[^\]\n]+\]/g) || [];
    if (authored.length) return { lyrics: text, marked: 0, authored: authored.length, style: null };
    const lines = text.split(/\r?\n/);
    const tagOf = line => { const m = (line || '').trim().match(SECTION_LINE_RE); return m ? m[1] : null; };
    const base = label => label.split(':')[0].trim();
    // 'Final Chorus'/'Last Chorus' — тоже припев; номера куплетов снимаются.
    const key = label => base(label).toLowerCase().replace(/^(?:final|last)\s+/, '').replace(/\s+\d+$/, '');
    const sections = {};
    const tagLines = [];
    lines.forEach((l, i) => {
      const t = tagOf(l);
      if (t) { tagLines.push(i); (sections[key(t)] = sections[key(t)] || []).push(i); }
    });
    // Нет секций — структуру не выдумываем (правило «ничего не выдумывать»).
    if (!tagLines.length) return none;
    // Стилевой профиль: явное семейство (черновик сессии) → жанровые слова caption.
    const family = styleOf(String(opts.caption || '') + ' ' + String(opts.style || ''), { style: opts.style });
    const profile = family && BRACKET_GROUPS[family] ? BRACKETS_BY_GROUP[BRACKET_GROUPS[family]] : BRACKETS_GENERIC;
    const captionBigrams = bracketBigrams(opts.caption);
    const usedFx = new Set();   // §3: ни один брекет не повторяет другой дословно
    const usedLine = new Set(); // §2.2: один брекет на секцию
    const pick = (pool, salt) => {
      const free = pool.filter(e => !usedFx.has(e) && ![...bracketBigrams(e)].some(b => captionBigrams.has(b)));
      return free.length ? free[hashText(text + '|' + (family || 'generic') + '|' + salt) % free.length] : null;
    };
    const enrich = (i, effect) => {
      const t = tagOf(lines[i]); if (!t) return false;
      lines[i] = '[' + base(t) + ': ' + effect + ']';
      return true;
    };
    // Норма плотности §3: ≤6 на полную лирику, коротким трекам (≤6 секций) — 3–4.
    const cap = tagLines.length <= 6 ? 4 : 6;
    const first = k => (sections[k] || [])[0];
    const last = k => { const a = sections[k] || []; return a.length ? a[a.length - 1] : undefined; };
    // Соло-слот (категория §1.5): interlude/solo/breakdown/drop; одиночный
    // [Instrumental] на всю лирику не размечаем — это не вставка, а режим.
    const soloAt = Object.keys(sections).length > 1
      ? tagLines.find(i => /(?:solo|interlude|breakdown|instrumental|drop)/.test(key(tagOf(lines[i]))))
      : undefined;
    const spaceAt = first('bridge') !== undefined ? first('bridge') : first('outro');
    // Приоритет чек-листа §3: lift финального припева (§2.7) → riser перед
    // первым припевом → куплет 2 ≠ куплет 1 → брекет пространства → интро →
    // соло-вставка → аутро. Незаполненный слот не тратит бюджет.
    const slots = [
      { at: last('chorus') !== undefined ? last('chorus') : last('hook'), pool: 'lift', salt: 'lift' },
      { at: first('pre-chorus'), pool: 'riser', salt: 'riser' },
      { at: (sections['verse'] || [])[1], pool: 'contrast', salt: 'verse2' },
      { at: spaceAt, pool: 'space', salt: 'space' },
      { at: first('intro'), pool: 'intro', salt: 'intro' },
      { at: soloAt, pool: 'solo', salt: 'solo' },
      { at: first('outro'), pool: 'outro', salt: 'outro' }
    ];
    let marked = 0;
    for (const slot of slots) {
      if (marked >= cap) break;
      if (slot.at === undefined || usedLine.has(slot.at)) continue;
      const effect = pick(profile[slot.pool] || BRACKETS_GENERIC[slot.pool], slot.salt);
      if (!effect) continue;
      if (enrich(slot.at, effect)) { usedFx.add(effect); usedLine.add(slot.at); marked++; }
    }
    return { lyrics: lines.join('\n'), marked, authored: 0, style: family || null };
  }

  const VERSION = '2026-11-23-lyrics-1';

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
    styleOf,
    markLyricsDynamics,
    // словари и слои открыты для проверок и отладки
    rules: {
      MAX_TAGS, MAX_CAPTION, MAX_CAPTION_WORDS, POSITIVE, LANG_TAGS,
      DEPTH_WORDS, DEPTH_BASE, STYLE_ATMOSPHERE, STYLE_ALIASES, resolveStyle, pickDepth,
      BRACKET_GROUPS, BRACKETS_BY_GROUP, BRACKETS_GENERIC, BRACKET_SLOTS,
      VOICE_IDENTITY, DEFAULT_VOICE_IDENTITY,
      VOCAL_AXIS_ORDER, VOCAL_AXIS_WORDS, GUARDED_AXIS_WORDS, VOCAL_PROFILES, VOCAL_CONTRA_PAIRS,
      layerOrder: ['anchor', 'voice', 'rhythm', 'space', 'arrangement', 'tail', 'guards'],
      captionOrder: ['vocals', 'language', 'genre', 'bpm', 'rhythm-section', 'instruments-roles', 'mix',
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
