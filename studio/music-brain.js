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
    ['dream pop', 'dream pop'], ['dream-pop', 'dream pop'],
    ['soul', 'soul'], ['funk', 'funk'], ['pop', 'pop'], ['rock', 'rock'],
    ['house', 'house'], ['techno', 'techno'], ['hip-hop', 'hip-hop'], ['hip hop', 'hip-hop'],
    ['rap', 'rap'], ['lofi', 'lo-fi'], ['cinematic', 'cinematic'], ['orchestral', 'orchestral'],
    ['jazz', 'jazz'], ['ballad', 'ballad'], ['edm', 'edm'], ['synthwave', 'synthwave'],
    ['retrowave', 'synthwave'], ['trip-hop', 'trip-hop'], ['trip hop', 'trip-hop'],
    ['rnb', 'r&b'], ['folk', 'folk'], ['phonk', 'phonk'], ['indie rock', 'rock'],
    // Н2 (симуляция #51): популярные у пользователей жанры, не входившие в
    // 23 семейства, — metal/eurodance/jungle/киномузыка оставляли голос
    // нейтральным. Профили — §2 справки владельца vocal-profile-vocabulary.md
    // («classic heavy metal / Metallica», «eurodance / Руки Вверх»).
    ['метал', 'heavy metal'], ['евродэнс', 'eurodance'], ['евроданс', 'eurodance'],
    ['евро-дэнс', 'eurodance'], ['евродэнц', 'eurodance'],
    ['джангл', 'drum and bass'], ['драм-н-бейс', 'drum and bass'], ['драм-энд-бейс', 'drum and bass'],
    ['киномузык', 'cinematic'], ['саундтрек', 'cinematic'],
    ['heavy metal', 'heavy metal'], ['metal', 'heavy metal'], ['thrash metal', 'heavy metal'],
    ['thrash', 'heavy metal'],
    ['eurodance', 'eurodance'], ['euro dance', 'eurodance'], ['euro-dance', 'eurodance'],
    ['drum and bass', 'drum and bass'], ['drum-and-bass', 'drum and bass'],
    ['drum n bass', 'drum and bass'], ['dnb', 'drum and bass'], ['jungle', 'drum and bass'],
    ['liquid dnb', 'drum and bass'], ['soundtrack', 'cinematic']
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
    // недостающие семейства (#45): профили обязаны покрывать все 26 семей
    // STYLE_ATMOSPHERE — паритет ловит тест check-music-brain (секция 15)
    'funk': { char: 'tight', groove: 'syncopated funk groove', kit: 'kick + snare, tight hats' },
    'dream pop': { char: 'laid-back', groove: 'soft steady groove', kit: 'kick + snare, brushed hats' },
    'synthwave': { char: 'driving', groove: 'steady synth drum groove', kit: 'kick + snare, gated snare reverb' },
    'r&b': { char: 'smooth', groove: 'slow smooth groove', kit: 'kick + snare, crisp hats' },
    // Н2 (#51): ритм-профили новых семейств — без них джангл получал
    // generic «fast steady drum groove (kick + snare)» вместо брейкбитов.
    'heavy metal': { char: 'heavy', groove: 'driving metal groove', kit: 'kick + snare, double-kick runs' },
    'eurodance': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: 'punchy kick + claps, offbeat rave bass' },
    'drum and bass': { char: 'fast', groove: 'fast chopped breakbeats', kit: 'chopped breakbeats, deep sub-bass' }
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
      processing: ['close-mic dry vocal'], guard: [GUARD_MALE], mood: 'warm' },
    // Н2 (#51): профили из §2 справки владельца (vocal-profile-vocabulary.md):
    // «classic heavy metal / Metallica», «eurodance / Руки Вверх» — справка
    // для этого и писалась; до сих пор металл получал поповый clean tone.
    // Правило 0 соблюдено: в мужских профилях нет thin/light/breathy.
    'heavy metal': { who: ['male vocals'], register: ['gritty baritone'], timbre: ['thick midrange timbre'],
      power: ['raspy aggressive delivery'], technique: ['sung verses shouted into a full-throated chorus'],
      character: ['menacing'], processing: ['punchy upfront vocal'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
    'eurodance': { who: ['young male vocals'], register: ['bright boyish tenor'], timbre: ['90s euro-pop timbre'],
      power: ['playful cheerful delivery'], technique: ['melodic pop phrasing'], character: ['playful'],
      processing: ['dry upfront vocal'], guard: [GUARD_MALE], mood: 'euphoric' },
    'drum and bass': { who: ['soulful female vocals'], timbre: ['bright timbre'], power: ['confident delivery'],
      technique: ['melodic pop phrasing'], processing: ['dry upfront vocal'], guard: [GUARD_FEMALE], mood: 'euphoric' }
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
    'r&b': ['clean modern production', 'silky top end'],
    // Н2 (#51): продакшн-профили новых семейств (паритет ловит тест, секция 15)
    'heavy metal': ['live room sound', 'punchy midrange'],
    'eurodance': ['clean 90s dance production', 'wide stereo mix'],
    'drum and bass': ['clean modern production', 'punchy low end']
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
    },
    // Н2 (#51): стилевые пулы новых семейств — приёмы жанровой практики,
    // как у остальных семей (RESEARCH_PACK §1: D6–D9).
    'heavy metal': {
      devices: ['doubled rhythm guitars panned hard left and right',
        'close dry drums with cranked room mics', 'palm-muted gallop riffing',
        'guitar solo riding on top of the mix', 'tight low-tuned rhythm guitars'],
      depth: ['guitars wide, vocal upfront in the middle', 'close dry drums, distant room mics behind']
    },
    'eurodance': {
      devices: ['pumping offbeat bass line', 'bright synth stabs answering the vocal',
        'hoover rave lead in the drop', 'gated drum machine'],
      depth: ['vocal upfront, synths wide behind', 'dry kick close, pad wash far behind']
    },
    'drum and bass': {
      devices: ['chopped breakbeats rolling over a sub-bass line',
        'dub delay stabs answered by the break', 'reese bass under fast hats',
        'long sub-bass tail under the break'],
      depth: ['break up close, sub-bass far below', 'dry drums, wide pad behind']
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
    'dream pop': 'dream pop', 'dream-pop': 'dream pop',
    'pop': 'pop', 'rock': 'rock', 'indie rock': 'rock',
    'techno': 'techno', 'tech house': 'tech house', 'house': 'house', 'edm': 'edm',
    'trap': 'trap', 'phonk': 'trap', 'rap': 'rap', 'хип-хоп': 'hip-hop', 'hip-hop': 'hip-hop',
    'lo-fi': 'lo-fi', 'ambient': 'ambient', 'cinematic': 'cinematic',
    'orchestral': 'orchestral', 'jazz': 'jazz', 'ballad': 'ballad',
    'synthwave': 'synthwave', 'trip-hop': 'trip-hop', 'r&b': 'r&b', 'folk': 'folk',
    'шансон': 'folk', 'chanson': 'folk',
    // #45 style pack: «shoegaze»/«trance»/«industrial»/«metalcore»/«nu metal» —
    // собственные семейства пакета (раньше алиасились в dream pop/edm/techno/
    // heavy metal); их ключи приходят из STYLE_PACK ниже.
    // английские алиасы семей (#45): черновик наставника пишет их в draft.style
    'rnb': 'r&b', 'hip hop': 'hip-hop', 'hiphop': 'hip-hop', 'lofi': 'lo-fi',
    'dreampop': 'dream pop', 'synth-pop': 'synthwave', 'synthpop': 'synthwave',
    'retrowave': 'synthwave', 'downtempo': 'trip-hop',
    // Н2 (#51): алиасы новых семейств — явная подсказка резолвера сильнее слов
    'heavy metal': 'heavy metal', 'metal': 'heavy metal', 'thrash': 'heavy metal',
    'thrash metal': 'heavy metal',
    'eurodance': 'eurodance', 'euro-dance': 'eurodance', 'euro dance': 'eurodance',
    'drum and bass': 'drum and bass', 'drum-and-bass': 'drum and bass',
    'drum n bass': 'drum and bass', 'dnb': 'drum and bass', 'jungle': 'drum and bass',
    'soundtrack': 'cinematic'
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
    'cinematic': 'score', 'orchestral': 'score',
    // Н2 (#51): новые семейства — метал в живую группу (гитарные соло,
    // gang vocals), евродэнс и джангл — в клубную динамику (дропы/райзеры).
    'heavy metal': 'band', 'eurodance': 'club', 'drum and bass': 'club'
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

  // ==== BEGIN STYLE PACK (#45) ====
  /* Сгенерировано tools/gen-style-pack.cjs из audits/style-research —
   * не редактировать руками (перегенерация перезапишет). Правки данных —
   * только в генераторе (карта правок с причинами) или в ресэрче. */
  const STYLE_PACK = {
    families: ['trance', 'industrial', 'deep house', 'progressive house', 'afro house', 'acid house', 'dub techno', 'hardstyle', 'gabber', 'happy hardcore', 'dubstep', 'uk garage', 'big beat', 'future bass', 'breakbeat', 'electro swing', 'idm', 'glitch', 'vaporwave', 'chiptune', 'dark ambient', 'drone', 'chillwave', 'witch house', 'footwork', 'moombahton', 'psytrance', 'drill', 'grime', 'boom bap', 'dancehall', 'reggae', 'dub', 'reggaeton', 'afrobeat', 'amapiano', 'samba', 'bossa nova', 'salsa', 'cumbia', 'latin', 'bhangra', 'mariachi', 'flamenco', 'tango', 'celtic', 'klezmer', 'fado', 'gypsy jazz', 'ska', 'rocksteady', 'bluegrass', 'country', 'americana', 'neo soul', 'gospel', 'blues', 'jazz fusion', 'swing', 'big band', 'ragtime', 'doo wop', 'motown', 'smooth jazz', 'blues rock', 'folk rock', 'indie folk', 'punk', 'post-punk', 'hardcore punk', 'pop punk', 'grunge', 'britpop', 'garage rock', 'surf rock', 'progressive rock', 'hard rock', 'stoner rock', 'gothic rock', 'new wave', 'post-rock', 'shoegaze', 'power metal', 'death metal', 'black metal', 'symphonic metal', 'folk metal', 'metalcore', 'nu metal', 'funk rock', 'rap metal', 'disco', 'nu-disco', 'italo disco', 'french house', 'city pop', 'k-pop', 'hyperpop', 'j-pop', 'new jack swing', 'miami bass', 'freestyle', 'europop', 'russian pop', 'classical', 'baroque', 'opera', 'gregorian', 'waltz', 'march', 'musical theatre', 'cabaret', 'lounge', 'easy listening', 'lullaby', 'children music'],
    genreWords: [
      ['трэнс', 'trance'], ['trance', 'trance'], ['uplifting trance', 'trance'],
      ['goa trance', 'trance'], ['psytrance', 'psytrance'], ['industrial', 'industrial'],
      ['дип-хаус', 'deep house'], ['deep house', 'deep house'], ['deephouse', 'deep house'],
      ['прогрессив-хаус', 'progressive house'], ['progressive house', 'progressive house'], ['афро-хаус', 'afro house'],
      ['afro house', 'afro house'], ['afrohouse', 'afro house'], ['эйсид-хаус', 'acid house'],
      ['acid house', 'acid house'], ['acid', 'acid house'], ['даб-техно', 'dub techno'],
      ['dub techno', 'dub techno'], ['хардстайл', 'hardstyle'], ['hardstyle', 'hardstyle'],
      ['габбер', 'gabber'], ['gabber', 'gabber'], ['gabba', 'gabber'],
      ['hardcore techno', 'gabber'], ['хэппи-хардкор', 'happy hardcore'], ['happy hardcore', 'happy hardcore'],
      ['дабстеп', 'dubstep'], ['dubstep', 'dubstep'], ['brostep', 'dubstep'],
      ['двухшаговый гараж', 'uk garage'], ['ю-кей гараж', 'uk garage'], ['uk garage', 'uk garage'],
      ['ukg', 'uk garage'], ['2-step garage', 'uk garage'], ['2-step', 'uk garage'],
      ['биг-бит', 'big beat'], ['big beat', 'big beat'], ['фьюче-бас', 'future bass'],
      ['future bass', 'future bass'], ['брейкбит', 'breakbeat'], ['breakbeat', 'breakbeat'],
      ['breaks', 'breakbeat'], ['электро-свинг', 'electro swing'], ['electro swing', 'electro swing'],
      ['идм', 'idm'], ['ИДМ', 'idm'], ['idm', 'idm'],
      ['intelligent dance music', 'idm'], ['глитч', 'glitch'], ['glitch', 'glitch'],
      ['glitch pop', 'glitch'], ['glitch-hop', 'glitch'], ['вэйпорвейв', 'vaporwave'],
      ['vaporwave', 'vaporwave'], ['чиптюн', 'chiptune'], ['восьмибитная музыка', 'chiptune'],
      ['chiptune', 'chiptune'], ['8-bit', 'chiptune'], ['chipmusic', 'chiptune'],
      ['тёмный эмбиент', 'dark ambient'], ['dark ambient', 'dark ambient'], ['дрон', 'drone'],
      ['drone', 'drone'], ['ambient drone', 'drone'], ['drone metal', 'drone'],
      ['чиллвейв', 'chillwave'], ['chillwave', 'chillwave'], ['вич-хаус', 'witch house'],
      ['witch house', 'witch house'], ['футворк', 'footwork'], ['footwork', 'footwork'],
      ['juke', 'footwork'], ['мумбатон', 'moombahton'], ['moombahton', 'moombahton'],
      ['сай-транс', 'psytrance'], ['дрилл', 'drill'], ['drill', 'drill'],
      ['uk drill', 'drill'], ['грайм', 'grime'], ['grime', 'grime'],
      ['бум-бэп', 'boom bap'], ['boom bap', 'boom bap'], ['дэнсхолл', 'dancehall'],
      ['dancehall', 'dancehall'], ['регги', 'reggae'], ['reggae', 'reggae'],
      ['roots reggae', 'reggae'], ['даб', 'dub'], ['dub', 'dub'],
      ['регетон', 'reggaeton'], ['reggaeton', 'reggaeton'], ['афробит', 'afrobeat'],
      ['afrobeat', 'afrobeat'], ['afrobeats', 'afrobeat'], ['амапьяно', 'amapiano'],
      ['amapiano', 'amapiano'], ['самба', 'samba'], ['samba', 'samba'],
      ['batucada', 'samba'], ['босса-нова', 'bossa nova'], ['bossa nova', 'bossa nova'],
      ['bossa', 'bossa nova'], ['сальса', 'salsa'], ['salsa', 'salsa'],
      ['timba', 'salsa'], ['кумбия', 'cumbia'], ['cumbia', 'cumbia'],
      ['латино', 'latin'], ['latin pop', 'latin'], ['latin', 'latin'],
      ['бхангра', 'bhangra'], ['bhangra', 'bhangra'], ['мариачи', 'mariachi'],
      ['mariachi', 'mariachi'], ['фламенко', 'flamenco'], ['flamenco', 'flamenco'],
      ['танго', 'tango'], ['tango', 'tango'], ['tango nuevo', 'tango'],
      ['кельтская музыка', 'celtic'], ['celtic', 'celtic'], ['irish folk', 'celtic'],
      ['celtic folk', 'celtic'], ['клезмер', 'klezmer'], ['klezmer', 'klezmer'],
      ['фаду', 'fado'], ['fado', 'fado'], ['цыганский джаз', 'gypsy jazz'],
      ['джаз-мануш', 'gypsy jazz'], ['gypsy jazz', 'gypsy jazz'], ['jazz manouche', 'gypsy jazz'],
      ['ska', 'ska'], ['ska punk', 'ska'], ['рокстеди', 'rocksteady'],
      ['rocksteady', 'rocksteady'], ['блюграсс', 'bluegrass'], ['bluegrass', 'bluegrass'],
      ['кантри', 'country'], ['country', 'country'], ['country pop', 'country'],
      ['американа', 'americana'], ['americana', 'americana'], ['alt-country', 'americana'],
      ['roots rock', 'americana'], ['нео-соул', 'neo soul'], ['neo soul', 'neo soul'],
      ['госпел', 'gospel'], ['gospel', 'gospel'], ['gospel choir', 'gospel'],
      ['блюз', 'blues'], ['blues', 'blues'], ['delta blues', 'blues'],
      ['chicago blues', 'blues'], ['джаз-фьюжн', 'jazz fusion'], ['jazz fusion', 'jazz fusion'],
      ['свинг', 'swing'], ['swing', 'swing'], ['vocal jazz', 'swing'],
      ['биг-бэнд', 'big band'], ['big band', 'big band'], ['рэгтайм', 'ragtime'],
      ['ragtime', 'ragtime'], ['ду-воп', 'doo wop'], ['doo wop', 'doo wop'],
      ['мотаун', 'motown'], ['motown', 'motown'], ['northern soul', 'motown'],
      ['смус-джаз', 'smooth jazz'], ['smooth jazz', 'smooth jazz'], ['блюз-рок', 'blues rock'],
      ['blues rock', 'blues rock'], ['фолк-рок', 'folk rock'], ['folk rock', 'folk rock'],
      ['инди-фолк', 'indie folk'], ['indie folk', 'indie folk'], ['панк', 'punk'],
      ['punk', 'punk'], ['punk rock', 'punk'], ['пост-панк', 'post-punk'],
      ['post-punk', 'post-punk'], ['хардкор-панк', 'hardcore punk'], ['hardcore punk', 'hardcore punk'],
      ['hardcore', 'hardcore punk'], ['d-beat', 'hardcore punk'], ['поп-панк', 'pop punk'],
      ['pop punk', 'pop punk'], ['гранж', 'grunge'], ['grunge', 'grunge'],
      ['бритпоп', 'britpop'], ['britpop', 'britpop'], ['гаражный рок', 'garage rock'],
      ['garage rock', 'garage rock'], ['garage punk', 'garage rock'], ['сёрф-рок', 'surf rock'],
      ['surf rock', 'surf rock'], ['surfar', 'surf rock'], ['прог-рок', 'progressive rock'],
      ['progressive rock', 'progressive rock'], ['prog rock', 'progressive rock'], ['prog', 'progressive rock'],
      ['хард-рок', 'hard rock'], ['hard rock', 'hard rock'], ['стоунер-рок', 'stoner rock'],
      ['stoner rock', 'stoner rock'], ['desert rock', 'stoner rock'], ['готик-рок', 'gothic rock'],
      ['gothic rock', 'gothic rock'], ['goth', 'gothic rock'], ['нью-вейв', 'new wave'],
      ['new wave', 'new wave'], ['пост-рок', 'post-rock'], ['post-rock', 'post-rock'],
      ['шугейз', 'shoegaze'], ['shoegaze', 'shoegaze'], ['nu gaze', 'shoegaze'],
      ['пауэр-метал', 'power metal'], ['power metal', 'power metal'], ['дэт-метал', 'death metal'],
      ['death metal', 'death metal'], ['melodic death metal', 'death metal'], ['блэк-метал', 'black metal'],
      ['black metal', 'black metal'], ['atmospheric black metal', 'black metal'], ['симфоник-метал', 'symphonic metal'],
      ['symphonic metal', 'symphonic metal'], ['фолк-метал', 'folk metal'], ['folk metal', 'folk metal'],
      ['viking metal', 'folk metal'], ['металкор', 'metalcore'], ['metalcore', 'metalcore'],
      ['deathcore', 'metalcore'], ['ню-метал', 'nu metal'], ['nu metal', 'nu metal'],
      ['фанк-рок', 'funk rock'], ['funk rock', 'funk rock'], ['рэп-метал', 'rap metal'],
      ['rap metal', 'rap metal'], ['rap rock', 'rap metal'], ['диско', 'disco'],
      ['disco', 'disco'], ['ну-диско', 'nu-disco'], ['nu-disco', 'nu-disco'],
      ['nudisco', 'nu-disco'], ['итало-диско', 'italo disco'], ['italo disco', 'italo disco'],
      ['italo dance', 'italo disco'], ['френч-хаус', 'french house'], ['french house', 'french house'],
      ['filter house', 'french house'], ['french touch', 'french house'], ['сити-поп', 'city pop'],
      ['city pop', 'city pop'], ['к-поп', 'k-pop'], ['k-pop', 'k-pop'],
      ['kpop', 'k-pop'], ['хайперпоп', 'hyperpop'], ['hyperpop', 'hyperpop'],
      ['bubblegum bass', 'hyperpop'], ['джей-поп', 'j-pop'], ['j-pop', 'j-pop'],
      ['jpop', 'j-pop'], ['нью-джек-свинг', 'new jack swing'], ['new jack swing', 'new jack swing'],
      ['swingbeat', 'new jack swing'], ['майами-бас', 'miami bass'], ['miami bass', 'miami bass'],
      ['booty bass', 'miami bass'], ['фристайл', 'freestyle'], ['freestyle', 'freestyle'],
      ['latin freestyle', 'freestyle'], ['европоп', 'europop'], ['europop', 'europop'],
      ['euro-pop', 'europop'], ['русская попса', 'russian pop'], ['русская эстрада', 'russian pop'],
      ['русская поп-музыка', 'russian pop'], ['russian pop', 'russian pop'], ['классика', 'classical'],
      ['классическая музыка', 'classical'], ['classical', 'classical'], ['orchestral classical', 'classical'],
      ['барокко', 'baroque'], ['baroque', 'baroque'], ['оперн', 'opera'],
      ['opera', 'opera'], ['aria', 'opera'], ['григорианский хорал', 'gregorian'],
      ['gregorian', 'gregorian'], ['gregorian chant', 'gregorian'], ['plainchant', 'gregorian'],
      ['вальс', 'waltz'], ['waltz', 'waltz'], ['march', 'march'],
      ['military march', 'march'], ['мюзикл', 'musical theatre'], ['musical theatre', 'musical theatre'],
      ['showtune', 'musical theatre'], ['broadway', 'musical theatre'], ['кабаре', 'cabaret'],
      ['cabaret', 'cabaret'], ['лаундж', 'lounge'], ['lounge', 'lounge'],
      ['exotica', 'lounge'], ['лёгкая музыка', 'easy listening'], ['эстрада', 'easy listening'],
      ['эстрадный лёгкий жанр', 'easy listening'], ['easy listening', 'easy listening'], ['колыбельная', 'lullaby'],
      ['lullaby', 'lullaby'], ['детская песня', 'children music'], ['детская музыка', 'children music'],
      ['children music', 'children music'], ['kids song', 'children music'], ['nursery rhyme', 'children music']
    ],
    aliases: {
      'trance': 'trance', 'uplifting trance': 'trance', 'goa trance': 'trance', 'psytrance': 'psytrance',
      'industrial': 'industrial', 'deep house': 'deep house', 'deephouse': 'deep house', 'progressive house': 'progressive house',
      'afro house': 'afro house', 'afrohouse': 'afro house', 'acid house': 'acid house', 'acid': 'acid house',
      'dub techno': 'dub techno', 'hardstyle': 'hardstyle', 'gabber': 'gabber', 'gabba': 'gabber',
      'hardcore techno': 'gabber', 'happy hardcore': 'happy hardcore', 'dubstep': 'dubstep', 'brostep': 'dubstep',
      'uk garage': 'uk garage', 'ukg': 'uk garage', '2-step garage': 'uk garage', '2-step': 'uk garage',
      'big beat': 'big beat', 'future bass': 'future bass', 'breakbeat': 'breakbeat', 'breaks': 'breakbeat',
      'electro swing': 'electro swing', 'idm': 'idm', 'intelligent dance music': 'idm', 'glitch': 'glitch',
      'glitch pop': 'glitch', 'glitch-hop': 'glitch', 'vaporwave': 'vaporwave', 'chiptune': 'chiptune',
      '8-bit': 'chiptune', 'chipmusic': 'chiptune', 'dark ambient': 'dark ambient', 'drone': 'drone',
      'ambient drone': 'drone', 'drone metal': 'drone', 'chillwave': 'chillwave', 'witch house': 'witch house',
      'footwork': 'footwork', 'juke': 'footwork', 'moombahton': 'moombahton', 'drill': 'drill',
      'uk drill': 'drill', 'grime': 'grime', 'boom bap': 'boom bap', 'dancehall': 'dancehall',
      'reggae': 'reggae', 'roots reggae': 'reggae', 'dub': 'dub', 'reggaeton': 'reggaeton',
      'afrobeat': 'afrobeat', 'afrobeats': 'afrobeat', 'amapiano': 'amapiano', 'samba': 'samba',
      'batucada': 'samba', 'bossa nova': 'bossa nova', 'bossa': 'bossa nova', 'salsa': 'salsa',
      'timba': 'salsa', 'cumbia': 'cumbia', 'latin pop': 'latin', 'latin': 'latin',
      'bhangra': 'bhangra', 'mariachi': 'mariachi', 'flamenco': 'flamenco', 'tango': 'tango',
      'tango nuevo': 'tango', 'celtic': 'celtic', 'irish folk': 'celtic', 'celtic folk': 'celtic',
      'klezmer': 'klezmer', 'fado': 'fado', 'gypsy jazz': 'gypsy jazz', 'jazz manouche': 'gypsy jazz',
      'ska': 'ska', 'ska punk': 'ska', 'rocksteady': 'rocksteady', 'bluegrass': 'bluegrass',
      'country': 'country', 'country pop': 'country', 'americana': 'americana', 'alt-country': 'americana',
      'roots rock': 'americana', 'neo soul': 'neo soul', 'gospel': 'gospel', 'gospel choir': 'gospel',
      'blues': 'blues', 'delta blues': 'blues', 'chicago blues': 'blues', 'jazz fusion': 'jazz fusion',
      'swing': 'swing', 'vocal jazz': 'swing', 'big band': 'big band', 'ragtime': 'ragtime',
      'doo wop': 'doo wop', 'motown': 'motown', 'northern soul': 'motown', 'smooth jazz': 'smooth jazz',
      'blues rock': 'blues rock', 'folk rock': 'folk rock', 'indie folk': 'indie folk', 'punk': 'punk',
      'punk rock': 'punk', 'post-punk': 'post-punk', 'hardcore punk': 'hardcore punk', 'hardcore': 'hardcore punk',
      'd-beat': 'hardcore punk', 'pop punk': 'pop punk', 'grunge': 'grunge', 'britpop': 'britpop',
      'garage rock': 'garage rock', 'garage punk': 'garage rock', 'surf rock': 'surf rock', 'surfar': 'surf rock',
      'progressive rock': 'progressive rock', 'prog rock': 'progressive rock', 'prog': 'progressive rock', 'hard rock': 'hard rock',
      'stoner rock': 'stoner rock', 'desert rock': 'stoner rock', 'gothic rock': 'gothic rock', 'goth': 'gothic rock',
      'new wave': 'new wave', 'post-rock': 'post-rock', 'shoegaze': 'shoegaze', 'nu gaze': 'shoegaze',
      'power metal': 'power metal', 'death metal': 'death metal', 'melodic death metal': 'death metal', 'black metal': 'black metal',
      'atmospheric black metal': 'black metal', 'symphonic metal': 'symphonic metal', 'folk metal': 'folk metal', 'viking metal': 'folk metal',
      'metalcore': 'metalcore', 'deathcore': 'metalcore', 'nu metal': 'nu metal', 'funk rock': 'funk rock',
      'rap metal': 'rap metal', 'rap rock': 'rap metal', 'disco': 'disco', 'nu-disco': 'nu-disco',
      'nudisco': 'nu-disco', 'italo disco': 'italo disco', 'italo dance': 'italo disco', 'french house': 'french house',
      'filter house': 'french house', 'french touch': 'french house', 'city pop': 'city pop', 'k-pop': 'k-pop',
      'kpop': 'k-pop', 'hyperpop': 'hyperpop', 'bubblegum bass': 'hyperpop', 'j-pop': 'j-pop',
      'jpop': 'j-pop', 'new jack swing': 'new jack swing', 'swingbeat': 'new jack swing', 'miami bass': 'miami bass',
      'booty bass': 'miami bass', 'freestyle': 'freestyle', 'latin freestyle': 'freestyle', 'europop': 'europop',
      'euro-pop': 'europop', 'russian pop': 'russian pop', 'classical': 'classical', 'orchestral classical': 'classical',
      'baroque': 'baroque', 'opera': 'opera', 'aria': 'opera', 'gregorian': 'gregorian',
      'gregorian chant': 'gregorian', 'plainchant': 'gregorian', 'waltz': 'waltz', 'march': 'march',
      'military march': 'march', 'musical theatre': 'musical theatre', 'showtune': 'musical theatre', 'broadway': 'musical theatre',
      'cabaret': 'cabaret', 'lounge': 'lounge', 'exotica': 'lounge', 'easy listening': 'easy listening',
      'lullaby': 'lullaby', 'children music': 'children music', 'kids song': 'children music', 'nursery rhyme': 'children music'
    },
    rhythm: {
      'trance': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: 'punchy kick, rolling offbeat bass' },
      'industrial': { char: 'heavy', groove: 'stomping industrial beat', kit: 'metallic percussion, clanging kicks' },
      'deep house': { char: 'smooth', groove: 'four-on-the-floor kick groove', kit: 'soft kick, warm filtered bass, shaker' },
      'progressive house': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: 'punchy kick, wide plucky synths' },
      'afro house': { char: 'organic', groove: 'four-on-the-floor kick groove', kit: 'log drum bass, djembe, shaker' },
      'acid house': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: 'drum machine kick, acid squelch bass' },
      'dub techno': { char: 'hypnotic', groove: 'straight kick pulse', kit: 'deep kick, rimshot, dub chord echoes' },
      'hardstyle': { char: 'heavy', groove: 'banging half-time hard kick', kit: 'distorted hard kick, screech lead' },
      'gabber': { char: 'fast', groove: 'hammering four-on-the-floor hardcore kick', kit: 'distorted gabber kick, reverse bass' },
      'happy hardcore': { char: 'fast', groove: 'rushing four-on-the-floor hardcore kick', kit: 'saturated kick, bouncy rave stabs' },
      'dubstep': { char: 'heavy', groove: 'half-time wobbling groove', kit: 'wobbling bass, half-time snare' },
      'uk garage': { char: 'bouncy', groove: 'swinging two-step groove', kit: 'shuffled kick and snare, sub bass' },
      'big beat': { char: 'heavy', groove: 'sawed-off breakbeat stomp', kit: 'fat breakbeat drums, filtered loops' },
      'future bass': { char: 'bouncy', groove: 'half-time bounce groove', kit: 'crisp trap hats, fat saw stabs' },
      'breakbeat': { char: 'broken', groove: 'broken breakbeat', kit: 'chopped breakbeat drums, fat bass' },
      'electro swing': { char: 'bouncy', groove: 'swinging electro groove', kit: 'swing drums, walking bass, scratch fills' },
      'idm': { char: 'broken', groove: 'glitched idm patterns', kit: 'cut-up drum programming, granular edits' },
      'glitch': { char: 'broken', groove: 'stuttering glitch edits', kit: 'glitched percussion, digital clicks' },
      'vaporwave': { char: 'slow', groove: 'slowed chopped groove', kit: 'slowed drum machine, soft kick' },
      'chiptune': { char: 'fast', groove: 'chippy pulse groove', kit: '8-bit drum machine, square-wave bleeps' },
      'dark ambient': { char: 'beatless', groove: 'drift without a drum kit', kit: 'sub-bass drone' },
      'drone': { char: 'beatless', groove: 'drift without a drum kit', kit: 'sustained sub drone' },
      'chillwave': { char: 'laid-back', groove: 'soft steady groove', kit: 'soft kick, hazy synth bass' },
      'witch house': { char: 'slow', groove: 'slowed chopped trap groove', kit: '808 kick, slowed hats' },
      'footwork': { char: 'fast', groove: 'syncopated footwork juke pattern', kit: 'juke hats, chopped vocal samples' },
      'moombahton': { char: 'bouncy', groove: 'dutty mid-tempo reggaeton bounce', kit: 'dutty bass, reggaeton drums' },
      'psytrance': { char: 'hypnotic', groove: 'rolling three-note bass groove', kit: 'four-on-the-floor kick, acid squelch' },
      'drill': { char: 'dark', groove: 'sliding drill groove', kit: 'sliding 808, skittering hats' },
      'grime': { char: 'fast', groove: 'squashing 140 eski beat', kit: 'square bass, icy snares' },
      'boom bap': { char: 'laid-back', groove: 'boom-bap groove', kit: 'dusty kick and snare, vinyl hats' },
      'dancehall': { char: 'bouncy', groove: 'digi riddim groove', kit: 'digi drums, rolling bass' },
      'reggae': { char: 'laid-back', groove: 'one-drop groove', kit: 'one-drop drums, fat offbeat bass' },
      'dub': { char: 'slow', groove: 'one-drop groove', kit: 'fat bass, echoing one-drop drums' },
      'reggaeton': { char: 'bouncy', groove: 'dembow groove', kit: 'dembow drums, punchy bass' },
      'afrobeat': { char: 'organic', groove: 'syncopated afrobeat groove', kit: 'percussion battery, rolling bass' },
      'amapiano': { char: 'smooth', groove: 'four-on-the-floor kick groove', kit: 'log drum bass, rolling shakers' },
      'samba': { char: 'organic', groove: 'samba batucada groove', kit: 'surdos, tamborim, shakers' },
      'bossa nova': { char: 'gentle', groove: 'bossa nova clave groove', kit: 'nylon guitar, rim clicks, shaker' },
      'salsa': { char: 'driving', groove: 'salsa clave groove', kit: 'congas, timbales, piano montuno' },
      'cumbia': { char: 'bouncy', groove: 'cumbia guira groove', kit: 'guira, guacharaca, accordion' },
      'latin': { char: 'bouncy', groove: 'latin pop groove', kit: 'reggaeton-tinged drums, nylon guitar' },
      'bhangra': { char: 'bouncy', groove: 'bhangra dhol groove', kit: 'dhol, tumbi, dholki' },
      'mariachi': { char: 'organic', groove: 'mariachi son rhythm', kit: 'mariachi guitars, trumpets, guitarron' },
      'flamenco': { char: 'organic', groove: 'flamenco compas groove', kit: 'flamenco guitar, cajon, palmas' },
      'tango': { char: 'dramatic', groove: 'tango habanera groove', kit: 'bandoneon, piano, violin' },
      'celtic': { char: 'organic', groove: 'celtic jig reel groove', kit: 'bodhran, fiddle, tin whistle' },
      'klezmer': { char: 'bouncy', groove: 'klezmer bulgar groove', kit: 'clarinet, violin, tsimbl' },
      'fado': { char: 'slow', groove: 'fado slow sway', kit: 'Portuguese guitar, viola chords' },
      'gypsy jazz': { char: 'bouncy', groove: 'manouche pompe swing', kit: 'acoustic guitars, upright bass' },
      'ska': { char: 'bouncy', groove: 'ska skank upbeat', kit: 'offbeat guitar skank, walking bass, horns' },
      'rocksteady': { char: 'slow', groove: 'rocksteady slow skank', kit: 'offbeat skank, fat bass' },
      'bluegrass': { char: 'driving', groove: 'bluegrass banjo roll groove', kit: 'banjo, fiddle, mandolin, upright bass' },
      'country': { char: 'organic', groove: 'country train beat', kit: 'twangy telecaster, acoustic strum, shuffling drums' },
      'americana': { char: 'organic', groove: 'americana roots sway', kit: 'acoustic guitar, brushed drums, upright bass' },
      'neo soul': { char: 'smooth', groove: 'neo soul pocket groove', kit: 'live drums, Fender Rhodes, fingerstyle bass' },
      'gospel': { char: 'organic', groove: 'gospel choir lift', kit: 'piano, organ, hand claps' },
      'blues': { char: 'loose', groove: 'blues shuffle', kit: 'electric guitar, walking bass, drums' },
      'jazz fusion': { char: 'driving', groove: 'fusion odd-meter groove', kit: 'electric piano, synth bass, dynamic drums' },
      'swing': { char: 'bouncy', groove: 'swing ride groove', kit: 'ride cymbal, walking bass, brushed snare' },
      'big band': { char: 'driving', groove: 'big band shout chorus', kit: 'horn section, walking bass, drum kicks' },
      'ragtime': { char: 'bouncy', groove: 'ragtime stride groove', kit: 'syncopated piano, banjo' },
      'doo wop': { char: 'slow', groove: 'doo wop ballad sway', kit: 'electric bass, sax, brushed drums' },
      'motown': { char: 'tight', groove: 'motown backbeat groove', kit: 'live drums, tambourine, walking bass' },
      'smooth jazz': { char: 'smooth', groove: 'smooth jazz pocket groove', kit: 'Fender Rhodes, soft drums, sax lead' },
      'blues rock': { char: 'heavy', groove: 'blues rock stomp shuffle', kit: 'cranked guitars, live drums' },
      'folk rock': { char: 'live', groove: 'folk rock strum groove', kit: 'acoustic strum, live drums, bass' },
      'indie folk': { char: 'organic', groove: 'indie folk gentle sway', kit: 'fingerpicked guitar, soft percussion' },
      'punk': { char: 'fast', groove: 'stripped punk gallop', kit: 'three-piece kit, buzzsaw guitars' },
      'post-punk': { char: 'driving', groove: 'motorik post-punk pulse', kit: 'bass-led groove, chorused guitars' },
      'hardcore punk': { char: 'fast', groove: 'd-beat hardcore pound', kit: 'd-beat drums, distorted guitars' },
      'pop punk': { char: 'fast', groove: 'pop punk drive', kit: 'double-time drums, power chords' },
      'grunge': { char: 'heavy', groove: 'grunge sludge swing', kit: 'detuned guitars, loose drums' },
      'britpop': { char: 'driving', groove: 'britpop jangle drive', kit: 'jangly guitars, live drums' },
      'garage rock': { char: 'raw', groove: 'garage stomp pound', kit: 'rattling drums, fuzzy guitar' },
      'surf rock': { char: 'twangy', groove: 'surf double-pick groove', kit: 'reverb-drenched twang guitar, tom-driven drums' },
      'progressive rock': { char: 'unhurried', groove: 'prog shifting-meter journey', kit: 'dynamic drums, mellotron, bass leads' },
      'hard rock': { char: 'heavy', groove: 'hard rock stomp riff', kit: 'crunched guitars, stomping drums' },
      'stoner rock': { char: 'heavy', groove: 'stoner fuzz slog', kit: 'fuzz guitar and bass, slow drums' },
      'gothic rock': { char: 'cold', groove: 'gothic rock pulse', kit: 'chorused guitars, tom-heavy kit' },
      'new wave': { char: 'clean', groove: 'new wave nervous pulse', kit: 'drum machine, jangle guitars, synth' },
      'post-rock': { char: 'slow', groove: 'post-rock slow build crescendo', kit: 'tremolo guitars, gradual drums' },
      'shoegaze': { char: 'laid-back', groove: 'shoegaze wash drift', kit: 'soft drums under a wall of guitars' },
      'power metal': { char: 'fast', groove: 'galloping double-kick power metal drive', kit: 'double-kick drums, palm-muted gallop guitars' },
      'death metal': { char: 'heavy', groove: 'blasting death metal assault', kit: 'blast beats, low-tuned rhythm guitars' },
      'black metal': { char: 'fast', groove: 'tremolo-ridden black metal blast', kit: 'blast beats, buzzing tremolo guitars' },
      'symphonic metal': { char: 'heavy', groove: 'orchestral metal drive', kit: 'double-kick drums, low-tuned guitars, orchestra' },
      'folk metal': { char: 'heavy', groove: 'stomping folk metal gallop', kit: 'double-kick drums, rhythm guitars, folk instruments' },
      'metalcore': { char: 'heavy', groove: 'metalcore breakdown drive', kit: 'double-kick drums, drop-tuned guitars' },
      'nu metal': { char: 'heavy', groove: 'nu metal syncopated sludge', kit: 'drop-tuned 7-string riffs, hip-hop drums' },
      'funk rock': { char: 'tight', groove: 'syncopated funk rock groove', kit: 'tight drums, slapping bass, wah guitar' },
      'rap metal': { char: 'heavy', groove: 'rap metal stomp groove', kit: 'drop-tuned riffs, hip-hop drums' },
      'disco': { char: 'tight', groove: 'disco four-on-the-floor groove', kit: 'orchestral drums, open hi-hats, funk bass' },
      'nu-disco': { char: 'bouncy', groove: 'filtered disco loop groove', kit: 'analog drums, filtered funk bass' },
      'italo disco': { char: 'driving', groove: 'italo drum machine groove', kit: 'drum machine, synth bass' },
      'french house': { char: 'driving', groove: 'four-on-the-floor kick groove', kit: 'four-on-the-floor kick, filtered disco loops' },
      'city pop': { char: 'bouncy', groove: 'city pop soft funk groove', kit: 'live drums, slap bass, FM electric piano' },
      'k-pop': { char: 'clean', groove: 'hybrid pop groove', kit: 'trap hats under pop drums' },
      'hyperpop': { char: 'bouncy', groove: 'maximalist hyperpop bounce', kit: 'clipped drums, distorted 808' },
      'j-pop': { char: 'driving', groove: 'bright rock-pop drive', kit: 'live drums, clean guitar, synth strings' },
      'new jack swing': { char: 'bouncy', groove: 'swingbeat groove', kit: 'drum machine, swinging hats, synthetic horns' },
      'miami bass': { char: 'bouncy', groove: '808 miami bass groove', kit: '808 kick, dirty rap hats' },
      'freestyle': { char: 'driving', groove: 'latin club machine groove', kit: 'drum machine, piano stabs' },
      'europop': { char: 'driving', groove: 'four-on-the-floor pop groove', kit: 'synth bass, drum machine' },
      'russian pop': { char: 'clean', groove: 'modern pop groove', kit: 'pop drums, synth bass' },
      'classical': { char: 'slow', groove: 'orchestral pulse', kit: 'timpani and low strings' },
      'baroque': { char: 'driving', groove: 'baroque terraced pulse', kit: 'harpsichord, strings, recorder' },
      'opera': { char: 'dramatic', groove: 'aria grand pulse', kit: 'orchestra, harp' },
      'gregorian': { char: 'slow', groove: 'chant unison flow', kit: 'unaccompanied voices, drone' },
      'waltz': { char: 'gentle', groove: 'three-beat waltz sway', kit: 'piano, strings, brushes' },
      'march': { char: 'steady', groove: 'two-beat striding pulse', kit: 'snare drum, brass, cymbals' },
      'musical theatre': { char: 'dramatic', groove: 'ensemble theatrical pulse', kit: 'pit orchestra, piano' },
      'cabaret': { char: 'slow', groove: 'cabaret vamp sway', kit: 'piano, upright bass, brushed drums' },
      'lounge': { char: 'smooth', groove: 'exotica sway groove', kit: 'vibraphone, nylon guitar, soft bongos' },
      'easy listening': { char: 'gentle', groove: 'string sway groove', kit: 'strings, soft drums, piano' },
      'lullaby': { char: 'gentle', groove: 'rocking three-beat sway', kit: 'music box, soft piano' },
      'children music': { char: 'bouncy', groove: 'sing-along bounce', kit: 'ukulele, hand claps, xylophone' },
    },
    production: {
      'trance': ['clean modern production', 'wide stereo mix'], 'industrial': ['distorted gritty production', 'wide stereo mix'],
      'deep house': ['analog warmth', 'tight low end'], 'progressive house': ['clean modern production', 'wide stereo mix'],
      'afro house': ['clean modern production', 'wide stereo mix'], 'acid house': ['analog warmth', 'tight low end'],
      'dub techno': ['dry driving production', 'deep reverb space'], 'hardstyle': ['loud brickwall master', 'punchy midrange'],
      'gabber': ['distorted gritty production', 'punchy midrange'], 'happy hardcore': ['clean 90s dance production', 'punchy midrange'],
      'dubstep': ['clean modern production', 'punchy low end'], 'uk garage': ['clean modern production', 'wide stereo mix'],
      'big beat': ['analog warmth', 'punchy midrange'], 'future bass': ['clean modern production', 'wide stereo mix'],
      'breakbeat': ['analog warmth', 'punchy midrange'], 'electro swing': ['analog warmth', 'wide stereo mix'],
      'idm': ['clean modern production', 'wide stereo mix'], 'glitch': ['clean digital production', 'wide stereo mix'],
      'vaporwave': ['tape saturation', 'AM radio broadcast texture'], 'chiptune': ['crunchy bit-crushed mix', 'mono centre'],
      'dark ambient': ['tape saturation', 'deep reverb space'], 'drone': ['analog warmth', 'deep reverb space'],
      'chillwave': ['analog warmth', 'tape saturation'], 'witch house': ['deep reverb space', 'distorted gritty production'],
      'footwork': ['clean modern production', 'punchy midrange'], 'moombahton': ['clean modern production', 'wide stereo mix'],
      'psytrance': ['clean modern production', 'wide stereo mix'], 'drill': ['clean modern production', 'punchy low end'],
      'grime': ['dry driving production', 'punchy midrange'], 'boom bap': ['tape saturation', 'vinyl crackle'],
      'dancehall': ['analog warmth', 'punchy low end'], 'reggae': ['analog warmth', 'tape saturation'],
      'dub': ['tape echo', 'deep reverb space'], 'reggaeton': ['clean modern production', 'punchy low end'],
      'afrobeat': ['live room sound', 'analog warmth'], 'amapiano': ['clean modern production', 'wide stereo mix'],
      'samba': ['live room sound', 'analog warmth'], 'bossa nova': ['intimate room sound', 'analog warmth'],
      'salsa': ['live room sound', 'punchy midrange'], 'cumbia': ['analog warmth', 'live room sound'],
      'latin': ['clean modern production', 'wide stereo mix'], 'bhangra': ['clean modern production', 'punchy midrange'],
      'mariachi': ['live room sound', 'analog warmth'], 'flamenco': ['intimate room sound', 'natural dynamics'],
      'tango': ['intimate room sound', 'analog warmth'], 'celtic': ['live room sound', 'natural dynamics'],
      'klezmer': ['live room sound', 'analog warmth'], 'fado': ['intimate room sound', 'analog warmth'],
      'gypsy jazz': ['live room sound', 'analog warmth'], 'ska': ['analog warmth', 'live room sound'],
      'rocksteady': ['analog warmth', 'live room sound'], 'bluegrass': ['live room sound', 'natural dynamics'],
      'country': ['analog warmth', 'live room sound'], 'americana': ['analog warmth', 'natural dynamics'],
      'neo soul': ['analog warmth', 'silky top end'], 'gospel': ['live room sound', 'natural dynamics'],
      'blues': ['analog warmth', 'live room sound'], 'jazz fusion': ['clean modern production', 'analog warmth'],
      'swing': ['live room sound', 'analog warmth'], 'big band': ['live room sound', 'analog warmth'],
      'ragtime': ['analog warmth', 'live room sound'], 'doo wop': ['analog warmth', 'tape saturation'],
      'motown': ['analog warmth', 'tape saturation'], 'smooth jazz': ['clean modern production', 'silky top end'],
      'blues rock': ['live room sound', 'punchy midrange'], 'folk rock': ['live room sound', 'analog warmth'],
      'indie folk': ['intimate room sound', 'natural dynamics'], 'punk': ['live room sound', 'raw lo-fi production'],
      'post-punk': ['dry close-mic production', 'cold reverb space'], 'hardcore punk': ['raw lo-fi production', 'punchy midrange'],
      'pop punk': ['clean modern production', 'punchy midrange'], 'grunge': ['live room sound', 'raw lo-fi production'],
      'britpop': ['analog warmth', 'live room sound'], 'garage rock': ['raw lo-fi production', 'live room sound'],
      'surf rock': ['analog warmth', 'live room sound'], 'progressive rock': ['analog warmth', 'natural dynamics'],
      'hard rock': ['live room sound', 'punchy midrange'], 'stoner rock': ['analog warmth', 'live room sound'],
      'gothic rock': ['cold reverb space', 'dry close-mic production'], 'new wave': ['clean modern production', 'dry close-mic production'],
      'post-rock': ['wide hall mix', 'natural dynamics'], 'shoegaze': ['reverb-drenched mix', 'soft focus production'],
      'power metal': ['live room sound', 'punchy midrange'], 'death metal': ['dense heavy production', 'punchy midrange'],
      'black metal': ['cold raw production', 'cold reverb space'], 'symphonic metal': ['wide cinematic mix', 'punchy midrange'],
      'folk metal': ['live room sound', 'punchy midrange'], 'metalcore': ['clean modern production', 'punchy midrange'],
      'nu metal': ['dense heavy production', 'punchy midrange'], 'funk rock': ['live room sound', 'punchy low end'],
      'rap metal': ['dense heavy production', 'punchy midrange'], 'disco': ['analog warmth', 'wide stereo mix'],
      'nu-disco': ['analog warmth', 'wide stereo mix'], 'italo disco': ['analog warmth', 'wide stereo mix'],
      'french house': ['analog warmth', 'wide stereo mix'], 'city pop': ['analog warmth', 'wide stereo mix'],
      'k-pop': ['clean modern production', 'wide stereo mix'], 'hyperpop': ['maximalist brickwall production', 'bit-crushed mix'],
      'j-pop': ['clean modern production', 'wide stereo mix'], 'new jack swing': ['clean late-80s production', 'punchy midrange'],
      'miami bass': ['analog warmth', 'punchy low end'], 'freestyle': ['clean 80s club production', 'wide stereo mix'],
      'europop': ['clean 90s dance production', 'wide stereo mix'], 'russian pop': ['clean modern production', 'wide stereo mix'],
      'classical': ['wide hall mix', 'natural dynamics'], 'baroque': ['intimate room sound', 'natural dynamics'],
      'opera': ['wide hall mix', 'natural dynamics'], 'gregorian': ['deep reverb space', 'natural dynamics'],
      'waltz': ['intimate room sound', 'natural dynamics'], 'march': ['live room sound', 'natural dynamics'],
      'musical theatre': ['intimate room sound', 'wide hall mix'], 'cabaret': ['analog warmth', 'intimate room sound'],
      'lounge': ['analog warmth', 'wide stereo mix'], 'easy listening': ['analog warmth', 'wide stereo mix'],
      'lullaby': ['intimate room sound', 'natural dynamics'], 'children music': ['dry close-mic production', 'natural dynamics']
    },
    atmosphere: {
      'trance': { devices: ['supersaw leads answering the break', 'long breakdown into a euphoric drop', 'sidechained pads breathing with the kick', 'rolling offbeat bass under the groove'],
        depth: ['dry kick close, supersaw wide behind', 'close groove, distant breakdown wash'] },
      'industrial': { devices: ['clanging metallic percussion', 'distorted drone underneath the beat', 'mechanical stutter rhythms', 'cold factory room tone'],
        depth: ['dry stomp close, distorted drone far behind', 'close mechanical beat, cavernous hall behind'] },
      'deep house': { devices: ['filtered jazz chords behind the groove', 'warm analog bass in the pocket', 'rolling shaker loop', 'dusty Rhodes chords over the bass'],
        depth: ['close bass, wide chord wash behind', 'dry vocal, distant filtered loop'] },
      'progressive house': { devices: ['long filtered build into the soft drop', 'plucky arpeggios answering the kick', 'wide pads breathing under the groove', 'slow tension curve across the whole track'],
        depth: ['dry kick close, pads far behind', 'close plucks, wide breakdown wash'] },
      'afro house': { devices: ['log drum bassline carrying the low end', 'rolling djembe polyrhythms', 'marimba stabs answering the kick', 'call-and-response chants in the background'],
        depth: ['close percussion, wide chant wash behind', 'dry kick, distant marimba loop'] },
      'acid house': { devices: ['TB-303 squelch answering the kick', 'filters slowly opening over the groove', 'cheap drum machine claps', 'hypnotic loop tightening every eight bars'],
        depth: ['dry kick close, squelch wide behind', 'mono groove, distant filter sweep'] },
      'dub techno': { devices: ['cavernous dub chords trailing the kick', 'deep ambient drones under the pulse', 'echo steps on the rimshot', 'foggy static texture behind the beat'],
        depth: ['dry kick close, echoes far behind', 'mono pulse, wide dub tail'] },
      'hardstyle': { devices: ['reverse bass rolling into the hard kick', 'screech leads answering the kick', 'long epic breakdown into the drop', 'pitched vocal hook over the master'],
        depth: ['dry kick close, screech wide behind', 'close drop, distant epic pads'] },
      'gabber': { devices: ['distorted kick hammering the beat', 'reverse bass rolling into the kick', 'shouted hardcore chants', 'screamer leads over the master'],
        depth: ['dry kick close, chants wide behind', 'close hammering kick, distant screamer lead'] },
      'happy hardcore': { devices: ['rushing kick under pitched-up vocal hooks', 'bright rave piano stabs', 'uplifting breakdown into the bounce', 'bright synth leads answering the kick'],
        depth: ['dry kick close, piano stabs wide behind', 'close hook, distant rave pads'] },
      'dubstep': { devices: ['wobble bass answering the half-time snare', 'sparse drums with sub weight', 'bass drop landing on the third beat', 'glitched vocal fragments over the drop'],
        depth: ['dry snare close, sub-bass far below', 'sparse drums, wide wobble behind'] },
      'uk garage': { devices: ['sped-up vocal chops over the shuffle', 'sub bass answering the snare', 'syncopated two-step hats', 'speed-garage hats rushing the shuffle'],
        depth: ['close shuffle, wide vocal chops behind', 'dry snare, distant sub sweep'] },
      'big beat': { devices: ['filtered breakbeat intro', 'fat drum hits slamming the loop', 'bass riff locking to the break', 'crowd samples answering the drums'],
        depth: ['dry drums close, filtered loop far behind', 'close stomp, distant siren texture'] },
      'future bass': { devices: ['supersaw chord stacks slamming the drop', 'pitched vocal chops as the lead', 'crisp hats rolling over the half-time bounce', 'detuned chord swell into the drop'],
        depth: ['dry vocal close, chord stack wide behind', 'close bounce, distant pad wash'] },
      'breakbeat': { devices: ['chopped breaks rolling under a bass riff', 'filter sweeps between the breaks', 'big drum breaks answering the bass', 'party chants in the background'],
        depth: ['dry breaks close, wide filter sweep behind', 'close drums, distant bass riff'] },
      'electro swing': { devices: ['vintage swing loop chopped into the beat', 'scratch fills answering the horns', 'clarinet licks over electro bass', 'big-band stabs slamming the groove'],
        depth: ['dry vocal close, swing loop wide behind', 'close horns, distant vinyl loop'] },
      'idm': { devices: ['cut-up drum edits flipping the pattern', 'granular textures dissolving between beats', 'evolving synthetic melodies', 'unusual time signatures shifting the grid'],
        depth: ['close glitches, wide drones behind', 'dry edit, distant granular wash'] },
      'glitch': { devices: ['stutter edits slicing the beat', 'digital clicks and pops as percussion', 'bit-crushed textures under the melody', 'fragmented vocal chops repeating'],
        depth: ['close clicks, wide digital wash behind', 'dry stutter, distant bit-crush tail'] },
      'vaporwave': { devices: ['slowed saxophone loops from another decade', 'mall ambience between the beats', 'chopped smooth-jazz chords', 'washed reverb over everything'],
        depth: ['distant slowed loop, close hiss in front', 'everything far behind a glassy veil'] },
      'chiptune': { devices: ['square-wave lead carrying the melody', 'arpeggios cycling like an arcade', 'noise-channel percussion', 'bouncy 8-bit bassline under the lead'],
        depth: ['close bleeps, narrow arcade mix', 'dry lead, distant echo bleeps'] },
      'dark ambient': { devices: ['sub-bass drones under everything', 'distant metallic echo', 'cavernous hall decay', 'eerie field recordings drifting by'],
        depth: ['everything far, nothing close', 'one close whisper against an endless hall'] },
      'drone': { devices: ['one sustained drone for the whole track', 'harmonics slowly blooming', 'bowed metal textures', 'overtones shifting above the drone'],
        depth: ['one close harmonic, endless tail behind', 'everything suspended in a single room'] },
      'chillwave': { devices: ['hazy synth pads washing the verse', 'chorused guitar arpeggio', 'sun-worn drum machine', 'cassette-worn bassline'],
        depth: ['hazy vocal close, pads wide behind', 'close drums, distant wash of chorus'] },
      'witch house': { devices: ['slowed pitch-warped vocal ghosts', '808 rumble under chopped hats', 'occult synth drones', 'hiss and static between sections'],
        depth: ['close hiss, distant pitch-warped vocal', 'dry 808 close, haunted pad wash behind'] },
      'footwork': { devices: ['chopped vocal samples repeating like a mantra', 'juke hats rolling at 160', 'syncopated sub stabs', 'relentless repeat-and-flip editing'],
        depth: ['close chops, wide juke pattern behind', 'dry repeat, distant sub stab'] },
      'moombahton': { devices: ['dutty bass sliding under reggaeton drums', 'vocal chops pitched and chopped', 'big room builds into a mid-tempo drop', 'air horns answering the drop'],
        depth: ['dry drums close, dutty bass wide behind', 'close bounce, distant build swell'] },
      'psytrance': { devices: ['rolling three-note bassline pulsing under the kick', 'acid squelches answering the bass', 'swirling effects rising between the drops', 'offbeat percussive loops stacking'],
        depth: ['dry kick close, swirls far behind', 'close bass roll, wide effect wash'] },
      'drill': { devices: ['sliding 808 moving between the notes', 'skittering hats doubling the flow', 'cold piano loop darkening the verse', 'masked gang chants answering the hook'],
        depth: ['dry vocal close, cold loop far behind', 'close flow, distant sliding 808'] },
      'grime': { devices: ['square-wave bass squeezing under the flow', 'icy snare cracks on the 140 grid', 'eerie strings answering the bars', 'radio edit stutter on the hook'],
        depth: ['dry bars close, square bass far below', 'close flow, distant eski bleeps'] },
      'boom bap': { devices: ['dusty chopped sample loop under the verse', 'vinyl crackle riding the snare', 'chopped jazz stab answering the kick', 'scratch fills between the bars'],
        depth: ['sample far back, drums close', 'close vocal, dusty loop behind'] },
      'dancehall': { devices: ['digital riddim answering the deejay', 'synth hooks sliding under the chant', 'hand percussion skanking the offbeat', 'bass rolling under the patois flow'],
        depth: ['close chant, riddim far behind', 'dry deejay, distant synth hook'] },
      'reggae': { devices: ['skanking guitar on the offbeat', 'bass carrying the melody in the pocket', 'one-drop drums with a loose swing', 'spring reverb doubling the vocal'],
        depth: ['close vocal, band two steps back', 'dry skank, distant spring tail'] },
      'dub': { devices: ['tape echoes swallowing the vocal line', 'spring reverb splashing the snare', 'bass and drums alone, everything else underwater', 'delayed chord stabs repeating into silence'],
        depth: ['close drums, echoes far behind', 'dry bass, distant drowning delay'] },
      'reggaeton': { devices: ['dembow pattern driving the verse', 'pitched vocal hooks answering the dembow', 'synth brass stabs on the hook', 'sub bass padding the bounce'],
        depth: ['dry vocal close, dembow far behind', 'close hook, distant synth brass'] },
      'afrobeat': { devices: ['highlife guitar picking over the pocket', 'talking drum answering the vocal', 'horn section riffing in unison', 'congas rolling under the groove'],
        depth: ['close vocal, band in one room behind', 'dry pocket, distant horns'] },
      'amapiano': { devices: ['log drum bouncing the low end', 'rolling shakers as the breath of the groove', 'jazzy Rhodes chords over the kick', 'airy whistles answering the chords'],
        depth: ['close chords, log drum far below', 'dry kick, distant whistle line'] },
      'samba': { devices: ['batucada battery rolling under the melody', 'cavaquinho strumming the syncopation', 'surdo marking the two-beat pulse', 'crowd clapping the partido alto'],
        depth: ['close battery, melody in front', 'dry cavaquinho, distant street behind'] },
      'bossa nova': { devices: ['nylon guitar carrying the harmony', 'brushed rim ticking the clave', 'soft bass walking under the chord', 'whispered breath close to the mic'],
        depth: ['vocal close, guitar one step back', 'close breath, distant room tone'] },
      'salsa': { devices: ['piano montuno cycling the clave', 'horn section shouting the coro', 'congas and timbales trading phrases', 'bass tumbao locking the pocket'],
        depth: ['close coro, montuno wide behind', 'dry vocal, distant timbale fill'] },
      'cumbia': { devices: ['accordion riffing over the gaita', 'guira ticking the dance rhythm', 'guacharaca scraping the offbeat', 'bass hopping on the one'],
        depth: ['close accordion, guira far behind', 'dry vocal, distant dance hall'] },
      'latin': { devices: ['nylon guitar folding into the pop groove', 'hand percussion under the chorus', 'romantic chord swells', 'bass with a tumbao lilt'],
        depth: ['vocal close, percussion wide behind', 'close chorus, distant guitar line'] },
      'bhangra': { devices: ['dhol hammering the celebration rhythm', 'tumbi plucking the hook', 'crowd call-and-response chants', 'modern bass under the folk loop'],
        depth: ['close dhol, chant wide behind', 'dry vocal, distant tumbi riff'] },
      'mariachi': { devices: ['trumpet answering the vocal', 'guitarron marking the pulse', 'violins sweeping between the lines', 'gritos riding the hook'],
        depth: ['close vocal, trumpets wide behind', 'dry guitar, distant violins'] },
      'flamenco': { devices: ['rasgueado bursts answering the cante', 'cajon marking the compas', 'palmas clapping the twelve-count', 'falsetas rising between the verses'],
        depth: ['close voice, guitar one step back', 'dry palmas, distant room'] },
      'tango': { devices: ['bandoneon sighing between the phrases', 'piano marking the habanera pulse', 'violin pizzicato under the melody', 'staccato stops before the phrase'],
        depth: ['close voice, bandoneon far behind', 'dry phrase, distant hall'] },
      'celtic': { devices: ['fiddle reels spinning over the bodhran', 'tin whistle answering the vocal', 'uilleann drones under the melody', 'group chorus on the last verse'],
        depth: ['close vocal, reels wide behind', 'dry whistle, distant hall'] },
      'klezmer': { devices: ['clarinet weeping then dancing', 'tsimbl shimmering under the melody', 'tuba oom-pah marking the beat', 'rapid freylakhs runs on the violin'],
        depth: ['close clarinet, band in one room', 'dry melody, distant tuba oom-pah'] },
      'fado': { devices: ['Portuguese guitar tremolo under the voice', 'viola bowing slow chords', 'saudade held in long tones', 'room falling silent between the verses'],
        depth: ['voice close, twelve-string far behind', 'dry long tone, distant room'] },
      'gypsy jazz': { devices: ['la pompe strumming driving the swing', 'violin trading with the lead guitar', 'unplugged acoustic solo runs', 'clarinet gliding over the riff'],
        depth: ['close lead guitar, pompe far behind', 'dry solo, distant room'] },
      'ska': { devices: ['offbeat skank chopping the upbeat', 'horn section hitting the riff', 'walking bass bouncing under the skank', 'organ bubble on the backbeat'],
        depth: ['close horns, skank wide behind', 'dry vocal, distant organ bubble'] },
      'rocksteady': { devices: ['bass carrying the melody', 'slow skank on the offbeat', 'horns answering lightly', 'piano bubble behind the vocal'],
        depth: ['close vocal, skank far behind', 'dry bass, distant spring tail'] },
      'bluegrass': { devices: ['banjo rolling through the break', 'fiddle and mandolin trading phrases', 'high harmony stacked on the chorus', 'upright bass thumping the two and four'],
        depth: ['close vocal, band one room', 'dry break, distant fiddle run'] },
      'country': { devices: ['telecaster twanging between the lines', 'pedal steel sighing under the chorus', 'train-beat shuffle keeping time', 'fiddle answering the hook'],
        depth: ['close vocal, band two steps back', 'dry twang, distant pedal steel'] },
      'americana': { devices: ['brushed drums keeping the sway', 'lap steel drifting under the verse', 'harmony duo on the chorus', 'mandolin filling between the lines'],
        depth: ['close voice, band one room', 'dry verse, distant lap steel'] },
      'neo soul': { devices: ['Rhodes chords breathing behind the vocal', 'fingerstyle bass answering the pocket', 'muted guitar licks in the gaps', 'stacked harmonies drifting on the hook'],
        depth: ['vocal close, Rhodes far behind', 'close pocket, distant harmonies'] },
      'gospel': { devices: ['full choir answering the lead', 'organ swelling under the amen', 'handclaps doubling the tambourine', 'piano walking into the vamp'],
        depth: ['lead close, choir wide behind', 'close piano, distant church hall'] },
      'blues': { devices: ['guitar answering each vocal line', 'shuffle riding the ride cymbal', 'harmonica crying between the bars', 'solo bending into the last chorus'],
        depth: ['voice close, band one room', 'dry vocal, distant harp'] },
      'jazz fusion': { devices: ['synth bass locking the odd meter', 'electric piano comping behind the solo', 'drums trading with the guitar', 'synth lead screaming over the changes'],
        depth: ['close solo, keys wide behind', 'dry drums, distant chord comp'] },
      'swing': { devices: ['big band riffing behind the vocal', 'ride swinging the whole track', 'sax section answering the line', 'drum kicks on the break'],
        depth: ['vocal close, band two steps back', 'dry vocal, distant brass riff'] },
      'big band': { devices: ['full shout chorus lifting the hook', 'sax soli trading with the trumpets', 'bass walking through the changes', 'drum bombs dropping on the turnarounds'],
        depth: ['vocal in front, brass wide behind', 'close vocal, distant sax soli'] },
      'ragtime': { devices: ['left-hand oom-pah under right-hand syncopation', 'stride runs taking the melody', 'banjo echoing the piano phrases', 'final chord held in the room'],
        depth: ['close piano, dry room', 'dry melody, distant banjo'] },
      'doo wop': { devices: ['group harmonies answering the lead', 'sax howling in the bridge', 'hand pats on the two and four', 'street-corner room around the voices'],
        depth: ['lead close, harmonies wide behind', 'close voices, distant sax'] },
      'motown': { devices: ['tambourine doubling the backbeat', 'bassline walking its own melody', 'horn stabs hitting the turnaround', 'handclaps riding the chorus'],
        depth: ['vocal close, band two steps back', 'dry chorus, distant horn stab'] },
      'smooth jazz': { devices: ['sax lead gliding over the pocket', 'Rhodes comping soft behind', 'fretless bass sliding under', 'soft hi-hat ticking the groove'],
        depth: ['close sax, keys far behind', 'dry pocket, distant pad wash'] },
      'blues rock': { devices: ['riff trading with a slide guitar', 'drums stomping the shuffle', 'solo climbing over the last chorus', 'bass walking under the stomp'],
        depth: ['guitars wide, vocal upfront', 'close stomp, distant room mics'] },
      'folk rock': { devices: ['twelve-string strum driving the verse', 'harmonies opening on the chorus', 'jangle guitar answering the vocal', 'drums arriving on the second verse'],
        depth: ['close vocal, band one room', 'dry verse, distant jangle'] },
      'indie folk': { devices: ['fingerpicking carrying the verse', 'group vocals swaying on the chorus', 'banjo shading the lines', 'soft percussion entering late'],
        depth: ['voice close, group far behind', 'dry verse, distant room tone'] },
      'punk': { devices: ['buzzsaw power chords on the downbeat', 'drums racing two steps ahead', 'gang vocals on the chorus', 'hook repeated until it breaks'],
        depth: ['everything close in one room', 'close shout, distant garage behind'] },
      'post-punk': { devices: ['bassline carrying the melody', 'chorused guitar scratch on the offbeat', 'cold synth accents between the verses', 'drums driving under the baritone'],
        depth: ['dry vocal close, cold room behind', 'close bass, distant chorus wash'] },
      'hardcore punk': { devices: ['d-beat pounding under shouted verses', 'breakdown hitting half-speed', 'gang shout on the last line', 'two-note riff until the end'],
        depth: ['everything close and raw', 'close pound, distant garage'] },
      'pop punk': { devices: ['power chords counting the track in', 'hook landing on the downbeat', 'woah-oh gang backing on the chorus', 'double-time bridge into the last chorus'],
        depth: ['close vocal, band one room', 'dry verse, distant gang vocals'] },
      'grunge': { devices: ['quiet verse flipping loud into the chorus', 'detuned riff sagging under the room', 'feedback ringing after the stop', 'drums dragging behind the beat'],
        depth: ['guitars wide, vocal upfront', 'close drums, distant room mics'] },
      'britpop': { devices: ['jangle chords opening the track', 'brass or keys accenting the chorus', 'big vowels held on the hook', 'octave guitars doubling the last chorus'],
        depth: ['vocal upfront, guitars wide behind', 'close vocal, distant jangle wash'] },
      'garage rock': { devices: ['fuzzy riff on the one', 'organ poking between the bars', 'tambourine rattling the stomp', 'everyone in one room'],
        depth: ['everything close and raw', 'close stomp, distant organ'] },
      'surf rock': { devices: ['twang double-picking the riff', 'wet reverb dripping off the lead', 'tom runs dragging the beat', 'sharp stabs stopping the groove'],
        depth: ['close twang, wet room behind', 'dry stabs, distant tom run'] },
      'progressive rock': { devices: ['meter shifting every section', 'mellotron pads opening the bridge', 'guitar solo riding over the suite', 'organ swelling before the finale'],
        depth: ['close vocal, hall far behind', 'dry solo, distant mellotron wash'] },
      'hard rock': { devices: ['riff counting the track in', 'chorus lifting an octave', 'solo answering the second chorus', 'drums cracking on the backbeat'],
        depth: ['guitars wide, vocal upfront', 'close stomp, distant room'] },
      'stoner rock': { devices: ['fuzz riff repeating like a ritual', 'drums laid back behind the downbeat', 'organ haze behind the amp wall', 'jam stretch before the last riff'],
        depth: ['amps wide, vocal in the middle', 'close fuzz, distant organ haze'] },
      'gothic rock': { devices: ['flanged guitar sheen over the tom pulse', 'bassline hanging below the baritone', 'cold synth lines between the verses', 'reverb swallowing the chorus'],
        depth: ['dry baritone close, cold hall behind', 'close pulse, distant flange wash'] },
      'new wave': { devices: ['drum machine clicking the nervous pulse', 'jangle guitar on the offbeat', 'synth hook answering the verse', 'choppy rhythm stopping before the chorus'],
        depth: ['dry vocal close, synth wide behind', 'close pulse, distant hook'] },
      'post-rock': { devices: ['quiet arpeggio looping until the drums enter', 'crescendo stacking layer over layer', 'tremolo wash cresting at the peak', 'sudden silence before the final theme'],
        depth: ['close arpeggio, hall far behind', 'dry loop, distant crescendo'] },
      'shoegaze': { devices: ['guitar wall hiding the melody', 'pedal swells folding into the vocal', 'soft drums buried in the wash', 'noise peak dissolving into the verse'],
        depth: ['dry vocal floating over a distant band', 'guitars far back, voice half-buried'] },
      'power metal': { devices: ['gallop riffing under the heroic vocal', 'keyboard fanfares answering the guitars', 'double-kick rolling through the chorus', 'epic choir pad behind the last chorus'],
        depth: ['guitars wide, vocal upfront in the middle', 'close drums, distant epic choir'] },
      'death metal': { devices: ['tremolo riffing under the growl', 'blast beats pounding the verses', 'guttural growl carrying the verse', 'slam breakdown stopping the blast'],
        depth: ['growl upfront, guitars wide behind', 'close blast, distant tremolo wash'] },
      'black metal': { devices: ['tremolo buzz wall carrying the verse', 'shrill screamed lines over the blast', 'cold synth pad opening the atmosphere', 'cavernous room around the kit'],
        depth: ['shriek upfront, buzz wall wide behind', 'close blast, distant cold synth'] },
      'symphonic metal': { devices: ['orchestra swelling behind the riff', 'operatic lead rising over the chorus', 'choir answering the hook', 'guitar solo trading with the strings'],
        depth: ['lead upfront, orchestra wide behind', 'close riff, distant choir hall'] },
      'folk metal': { devices: ['bagpipe or fiddle riffing over the gallop', 'chanted drinking chorus', 'acoustic folk break before the blast', 'war drums doubling the kick'],
        depth: ['chant upfront, band wide behind', 'close gallop, distant folk riff'] },
      'metalcore': { devices: ['screamed verse flipping into a sung chorus', 'breakdown chugging at half-speed', 'pinch-harmonic squeals answering the riff', 'gang shout on the bridge'],
        depth: ['scream upfront, wall wide behind', 'close breakdown, distant clean chorus'] },
      'nu metal': { devices: ['syncopated low riff answering the flow', 'rapped verse into a sung hook', 'DJ scratches between the sections', 'quiet echo break before the last chorus'],
        depth: ['flow upfront, riff wide behind', 'close chug, distant echo break'] },
      'funk rock': { devices: ['slap bass popping under the verse', 'wah guitar answering the vocal', 'staccato riff locking to the kick', 'horn stab on the turnaround'],
        depth: ['everything close and dry', 'close drums, one distant room mic'] },
      'rap metal': { devices: ['riff slamming under the rap flow', 'half-time stomp before the hook', 'turntable cut answering the verse', 'crowd shout doubling the hook'],
        depth: ['flow upfront, riff wide behind', 'close stomp, distant cut'] },
      'disco': { devices: ['string section answering the vocal', 'octave chicken-pick guitar', 'open hi-hat pumping the four', 'orchestral drum break into the chorus'],
        depth: ['vocal close, strings wide behind', 'close groove, distant string sweep'] },
      'nu-disco': { devices: ['filtered loop opening over the groove', 'chopped strings repeating the riff', 'claps on the two and four', 'bassline bouncing under the filter'],
        depth: ['dry kick close, filter sweep far behind', 'close groove, distant chopped strings'] },
      'italo disco': { devices: ['cold synth arpeggio under the hook', 'drum machine cracking the beat', 'synth brass answering the vocal', 'spacey pads behind the chorus'],
        depth: ['dry vocal close, arpeggio wide behind', 'close beat, distant space pad'] },
      'french house': { devices: ['sidechained compression pumping the chords', 'disco loop chopped and filtered', 'phaser sweeping the hats', 'filtered break into the drop'],
        depth: ['dry kick close, filtered loop wide behind', 'close groove, distant sweep'] },
      'city pop': { devices: ['glassy FM electric piano over the verse', 'slap bass popping under the chorus', 'horn licks answering the hook', 'chorused guitar arpeggio behind'],
        depth: ['vocal close, horns wide behind', 'close keys, distant horn lick'] },
      'k-pop': { devices: ['rap verse flipping into a sung chorus', 'massive stacked hook vocals', 'half-time breakdown before the last chorus', 'synth brass stab answering the hook'],
        depth: ['hook upfront, synths wide behind', 'close vocal, distant synth stack'] },
      'hyperpop': { devices: ['pitched-up vocal jumping octaves', 'clipped drums slamming the beat', 'brash detuned synth riffs', 'abrupt switch-up between sections'],
        depth: ['vocal jammed in front of the wall', 'close clipping, distant glitch tail'] },
      'j-pop': { devices: ['fast syllable delivery riding the beat', 'synth strings swelling the chorus', 'clean guitar riff under the hook', 'key change into the last chorus'],
        depth: ['vocal upfront, strings wide behind', 'close vocal, distant string swell'] },
      'new jack swing': { devices: ['swung drum machine driving the beat', 'synthetic horn stabs on the turnaround', 'rap verse answering the sung hook', 'full-stop break before the chorus'],
        depth: ['hook upfront, stabs wide behind', 'close beat, distant horn stab'] },
      'miami bass': { devices: ['booming 808 carrying the groove', 'chanting hook over the beat', 'scratch fills between the bars', 'claps on the two and four'],
        depth: ['808 close and huge, chant in front', 'close 808, distant scratch'] },
      'freestyle': { devices: ['tinny drum machine rolling the beat', 'piano stabs answering the vocal', 'heartbreak hook over the machine beat', 'sweet synth pad behind the chorus'],
        depth: ['vocal upfront, piano wide behind', 'close vocal, distant pad wash'] },
      'europop': { devices: ['synth hook repeating the title line', 'drum machine keeping the four', 'male rap bridge answering the chorus', 'rave piano break before the last chorus'],
        depth: ['vocal upfront, synth hook wide behind', 'close vocal, distant rave piano'] },
      'russian pop': { devices: ['radio-polished lead vocal', 'synth pad under the chorus', 'drop-chorus with vocal chops', 'guitar lick accenting the hook'],
        depth: ['vocal upfront, pads wide behind', 'close vocal, distant drop wash'] },
      'classical': { devices: ['string section carrying the theme', 'woodwinds answering the strings', 'timpani rolling under the crescendo', 'soloist rising above the ensemble'],
        depth: ['close soloist, hall far behind', 'strings far back, percussion close'] },
      'baroque': { devices: ['harpsichord driving the continuo', 'counterpoint weaving the voices', 'terraced dynamics flipping the section', 'fugal entry on the theme'],
        depth: ['close ensemble, dry room', 'close harpsichord, distant strings'] },
      'opera': { devices: ['aria rising over the orchestra', 'orchestra swelling under the phrase', 'recitative dropped to speech before the aria', 'coloratura runs on the finale'],
        depth: ['voice on top, orchestra far behind', 'close voice, distant hall'] },
      'gregorian': { devices: ['voices in unison over a drone', 'modal lines floating without a beat', 'cathedral tail holding each phrase', 'plainchant answering in octaves'],
        depth: ['voices close, endless cathedral tail', 'everything suspended in stone'] },
      'waltz': { devices: ['oom-pah-pah under the melody', 'strings swaying the second theme', 'accordion or piano taking the lead', 'rubato bending the beat before the turn'],
        depth: ['melody close, room one step back', 'close piano, distant hall'] },
      'march': { devices: ['snare line rolling under the brass', 'brass chord on the strong beat', 'counter-melody on the trio section', 'cymbal crash on the downbeat'],
        depth: ['brass upfront, snare wide behind', 'close brass, distant parade field'] },
      'musical theatre': { devices: ['verse spoken into song', 'orchestra swelling behind the reprise', 'ensemble answering the lead', 'key lift on the finale'],
        depth: ['lead upfront, orchestra wide behind', 'close voice, distant pit orchestra'] },
      'cabaret': { devices: ['vamp repeating under the verse', 'piano fills answering the line', 'wink-and-smile pauses before the punchline', 'brush sweep into the chorus'],
        depth: ['voice close, band one room', 'close piano, distant applause room'] },
      'lounge': { devices: ['vibraphone rolling the melody', 'soft bongos ticking the sway', 'string pad floating behind', 'wordless vocalise answering the theme'],
        depth: ['vibes close, pad far behind', 'close theme, distant tiki room'] },
      'easy listening': { devices: ['string section sweeping the melody', 'soft drums barely tapping', 'harp glissando between phrases', 'wordless vocalise over the bridge'],
        depth: ['melody close, strings wide behind', 'close vocal, distant harp gliss'] },
      'lullaby': { devices: ['music box opening the theme', 'harp or celesta twinkling', 'voice barely above the accompaniment', 'fade to a single sustained chord'],
        depth: ['voice close, room silent behind', 'close breath, distant music box'] },
      'children music': { devices: ['xylophone bouncing the melody', 'sing-along chorus repeated twice', 'claps on every second beat', 'playful sound-effect accents'],
        depth: ['voice close, claps wide behind', 'close ukulele, distant claps'] },
    },
    vocal: {
      'trance': { who: ['female vocals'], timbre: ['bright timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'industrial': { who: ['male vocals'], register: ['gritty baritone'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'deep house': { who: ['soulful female vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
      'progressive house': { who: ['female vocals'], timbre: ['bright timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'afro house': { who: ['female vocals'], timbre: ['warm timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'acid house': { who: ['male vocals'], timbre: ['chest voice'], power: ['spoken-sung'], guard: [GUARD_LOW_MALE], mood: 'hypnotic' },
      'dub techno': { who: ['female vocals'], timbre: ['thin vocals'], power: ['detached delivery'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
      'hardstyle': { who: ['female vocals'], timbre: ['bright timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'aggressive' },
      'gabber': { who: ['male vocals'], register: ['gritty baritone'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'happy hardcore': { who: ['female vocals'], timbre: ['bright timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'dubstep': { who: ['male vocals'], timbre: ['rough texture'], power: ['gritty aggressive delivery'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'uk garage': { who: ['soulful female vocals'], timbre: ['smooth timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'big beat': { who: ['male vocals'], timbre: ['chest voice'], power: ['spoken word'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'future bass': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'breakbeat': { who: ['male vocals'], timbre: ['chest voice'], power: ['spoken word'], guard: [GUARD_LOW_MALE], mood: 'euphoric' },
      'electro swing': { who: ['female vocals'], timbre: ['velvet tone'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'playful' },
      'idm': { who: ['female vocals'], timbre: ['breathy tone'], power: ['intimate delivery'], guard: [GUARD_FEMALE], mood: 'dreamy' },
      'glitch': { who: ['female vocals'], timbre: ['thin vocals'], power: ['detached delivery'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
      'vaporwave': { who: ['female vocals'], timbre: ['glassy timbre'], power: ['detached delivery'], guard: [GUARD_FEMALE], mood: 'nostalgic' },
      'chiptune': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'cheerful' },
      'dark ambient': { who: ['female vocals'], timbre: ['breathy tone'], power: ['whispered delivery'], guard: [GUARD_FEMALE], mood: 'haunting' },
      'drone': { who: ['female vocals'], timbre: ['breathy tone'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'meditative' },
      'chillwave': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_MALE], mood: 'nostalgic' },
      'witch house': { who: ['female vocals'], timbre: ['thin vocals'], power: ['detached delivery'], guard: [GUARD_FEMALE], mood: 'dark' },
      'footwork': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
      'moombahton': { who: ['male vocals'], timbre: ['warm timbre'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'euphoric' },
      'psytrance': { who: ['female vocals'], timbre: ['thin vocals'], power: ['detached delivery'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
      'drill': { who: ['male vocals'], timbre: ['chest voice'], power: ['confident spoken-word flow'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'grime': { who: ['male vocals'], timbre: ['chest voice'], power: ['chanted delivery'], guard: [GUARD_LOW_MALE], mood: 'urban' },
      'boom bap': { who: ['male vocals'], timbre: ['gravel texture'], power: ['laid-back spoken-word flow'], guard: [GUARD_LOW_MALE], mood: 'urban' },
      'dancehall': { who: ['male vocals'], timbre: ['rough texture'], power: ['chanted delivery'], guard: [GUARD_LOW_MALE], mood: 'sensual' },
      'reggae': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_MALE], mood: 'warm' },
      'dub': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_MALE], mood: 'hypnotic' },
      'reggaeton': { who: ['male vocals'], timbre: ['warm timbre'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'sensual' },
      'afrobeat': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_MALE], mood: 'euphoric' },
      'amapiano': { who: ['female vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'samba': { who: ['female vocals'], timbre: ['warm timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'bossa nova': { who: ['female vocals'], timbre: ['breathy tone'], power: ['intimate delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'salsa': { who: ['male vocals'], timbre: ['warm timbre'], power: ['powerful belting'], guard: [GUARD_MALE], mood: 'euphoric' },
      'cumbia': { who: ['male vocals'], timbre: ['warm timbre'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'latin': { who: ['female vocals'], timbre: ['warm timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'bhangra': { who: ['male vocals'], timbre: ['warm timbre'], power: ['chanted delivery'], guard: [GUARD_MALE], mood: 'euphoric' },
      'mariachi': { who: ['male vocals'], timbre: ['warm timbre'], power: ['powerful belting'], guard: [GUARD_MALE], mood: 'emotional' },
      'flamenco': { who: ['male vocals'], timbre: ['rough texture'], power: ['powerful belting'], guard: [GUARD_MALE], mood: 'emotional' },
      'tango': { who: ['male vocals'], timbre: ['warm timbre'], power: ['full-voice delivery'], guard: [GUARD_MALE], mood: 'melancholic' },
      'celtic': { who: ['female vocals'], timbre: ['warm timbre'], power: ['plain intimate delivery'], guard: [GUARD_FEMALE], mood: 'nostalgic' },
      'klezmer': { who: ['male vocals'], timbre: ['warm timbre'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'fado': { who: ['female vocals'], timbre: ['warm timbre'], power: ['full-voice delivery'], guard: [GUARD_FEMALE], mood: 'melancholic' },
      'gypsy jazz': { who: ['male vocals'], timbre: ['warm timbre'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'ska': { who: ['male vocals'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'rocksteady': { who: ['male vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_MALE], mood: 'warm' },
      'bluegrass': { who: ['male vocals'], timbre: ['warm timbre'], power: ['full-voice delivery'], guard: [GUARD_MALE], mood: 'warm' },
      'country': { who: ['male vocals'], timbre: ['warm timbre'], power: ['plain intimate delivery'], guard: [GUARD_MALE], mood: 'warm' },
      'americana': { who: ['male vocals'], timbre: ['gravel texture'], power: ['plain intimate delivery'], guard: [GUARD_MALE], mood: 'melancholic' },
      'neo soul': { who: ['female vocals'], timbre: ['velvet tone'], power: ['soft intimate delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'gospel': { who: ['choir'], timbre: ['warm timbre'], power: ['powerful belting'], guard: [GUARD_CHOIR], mood: 'emotional' },
      'blues': { who: ['male vocals'], timbre: ['hoarse rasp'], power: ['crooned delivery'], guard: [GUARD_MALE], mood: 'melancholic' },
      'jazz fusion': { who: ['female vocals'], timbre: ['smooth timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'hypnotic' },
      'swing': { who: ['male vocals'], timbre: ['velvet tone'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'big band': { who: ['female vocals'], timbre: ['velvet tone'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'ragtime': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'cheerful' },
      'doo wop': { who: ['male vocals'], timbre: ['velvet tone'], power: ['crooned delivery'], guard: [GUARD_MALE], mood: 'nostalgic' },
      'motown': { who: ['female vocals'], timbre: ['warm timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'smooth jazz': { who: ['female vocals'], timbre: ['smooth timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'blues rock': { who: ['male vocals'], timbre: ['hoarse rasp'], power: ['raspy aggressive delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'folk rock': { who: ['male vocals'], timbre: ['warm timbre'], power: ['full-voice delivery'], guard: [GUARD_MALE], mood: 'warm' },
      'indie folk': { who: ['male vocals'], timbre: ['warm timbre'], power: ['intimate delivery'], guard: [GUARD_MALE], mood: 'melancholic' },
      'punk': { who: ['male vocals'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'post-punk': { who: ['male vocals'], register: ['gritty baritone'], power: ['detached delivery'], timbre: ['thick midrange timbre'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'hardcore punk': { who: ['male vocals'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'pop punk': { who: ['male vocals'], timbre: ['nasal timbre'], power: ['full-voice delivery'], guard: [GUARD_LOW_MALE], mood: 'euphoric' },
      'grunge': { who: ['male vocals'], timbre: ['gravel texture'], power: ['raspy aggressive delivery'], guard: [GUARD_LOW_MALE], mood: 'melancholic' },
      'britpop': { who: ['male vocals'], timbre: ['warm timbre'], power: ['confident delivery'], guard: [GUARD_MALE], mood: 'nostalgic' },
      'garage rock': { who: ['male vocals'], timbre: ['hoarse rasp'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'surf rock': { who: ['male vocals'], timbre: ['chest voice'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'progressive rock': { who: ['male vocals'], timbre: ['warm timbre'], power: ['full-voice delivery'], guard: [GUARD_MALE], mood: 'anthemic' },
      'hard rock': { who: ['male vocals'], timbre: ['gravel texture'], power: ['raspy aggressive delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'stoner rock': { who: ['male vocals'], timbre: ['gravel texture'], power: ['laid-back delivery'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'gothic rock': { who: ['male vocals'], register: ['male baritone'], power: ['detached delivery'], timbre: ['warm timbre'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'new wave': { who: ['male vocals'], timbre: ['nasal timbre'], power: ['detached delivery'], guard: [GUARD_MALE], mood: 'nostalgic' },
      'post-rock': { who: ['female vocals'], timbre: ['breathy tone'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'cinematic' },
      'shoegaze': { who: ['female vocals'], timbre: ['breathy tone'], power: ['fragile intimate delivery'], guard: [GUARD_FEMALE], mood: 'dreamy' },
      'power metal': { who: ['male vocals'], register: ['heroic chesty tenor'], timbre: ['bright timbre'], power: ['powerful belting'], guard: [GUARD_MALE], mood: 'heroic' },
      'death metal': { who: ['male vocals'], register: ['gritty baritone'], timbre: ['rough texture'], power: ['gritty aggressive delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'black metal': { who: ['male vocals'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'dark' },
      'symphonic metal': { who: ['female vocals'], register: ['soprano'], timbre: ['bright timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'anthemic' },
      'folk metal': { who: ['male vocals'], timbre: ['gravel texture'], power: ['chanted delivery'], guard: [GUARD_LOW_MALE], mood: 'euphoric' },
      'metalcore': { who: ['male vocals'], register: ['gritty baritone'], timbre: ['rough texture'], power: ['shouted delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'nu metal': { who: ['male vocals'], timbre: ['gravel texture'], power: ['chanted delivery'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'funk rock': { who: ['male vocals'], timbre: ['chest voice'], power: ['laid-back delivery'], guard: [GUARD_MALE], mood: 'playful' },
      'rap metal': { who: ['male vocals'], timbre: ['chest voice'], power: ['confident spoken-word flow'], guard: [GUARD_LOW_MALE], mood: 'aggressive' },
      'disco': { who: ['female vocals'], timbre: ['bright timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'nu-disco': { who: ['female vocals'], timbre: ['velvet tone'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'italo disco': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'french house': { who: ['female vocals'], timbre: ['smooth timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'city pop': { who: ['female vocals'], timbre: ['glassy timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'nostalgic' },
      'k-pop': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'hyperpop': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'j-pop': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'new jack swing': { who: ['male vocals'], timbre: ['smooth timbre'], power: ['playful cheerful delivery'], guard: [GUARD_MALE], mood: 'sensual' },
      'miami bass': { who: ['male vocals'], timbre: ['chest voice'], power: ['spoken word'], guard: [GUARD_LOW_MALE], mood: 'urban' },
      'freestyle': { who: ['female vocals'], timbre: ['bright timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'emotional' },
      'europop': { who: ['female vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'russian pop': { who: ['female vocals'], timbre: ['warm timbre'], power: ['confident delivery'], guard: [GUARD_FEMALE], mood: 'euphoric' },
      'classical': { who: ['female vocals'], register: ['soprano'], timbre: ['warm timbre'], power: ['stately delivery'], guard: [GUARD_FEMALE], mood: 'cinematic' },
      'baroque': { who: ['female vocals'], register: ['soprano'], timbre: ['bright timbre'], power: ['stately delivery'], guard: [GUARD_FEMALE], mood: 'cinematic' },
      'opera': { who: ['female vocals'], register: ['soprano'], power: ['powerful belting'], timbre: ['bright timbre'], guard: [GUARD_FEMALE], mood: 'emotional' },
      'gregorian': { who: ['choir'], timbre: ['warm timbre'], power: ['stately delivery'], guard: [GUARD_CHOIR], mood: 'meditative' },
      'waltz': { who: ['female vocals'], timbre: ['warm timbre'], power: ['intimate delivery'], guard: [GUARD_FEMALE], mood: 'nostalgic' },
      'march': { who: ['male vocals'], timbre: ['chest voice'], power: ['full-voice delivery'], guard: [GUARD_MALE], mood: 'heroic' },
      'musical theatre': { who: ['female vocals'], timbre: ['bright timbre'], power: ['powerful belting'], guard: [GUARD_FEMALE], mood: 'emotional' },
      'cabaret': { who: ['female vocals'], timbre: ['velvet tone'], power: ['crooned delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'lounge': { who: ['female vocals'], timbre: ['velvet tone'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'sensual' },
      'easy listening': { who: ['female vocals'], timbre: ['warm timbre'], power: ['laid-back delivery'], guard: [GUARD_FEMALE], mood: 'warm' },
      'lullaby': { who: ['female vocals'], timbre: ['breathy tone'], power: ['whispered delivery'], guard: [GUARD_FEMALE], mood: 'dreamy' },
      'children music': { who: ['child-like vocals'], timbre: ['bright timbre'], power: ['playful cheerful delivery'], guard: [GUARD_FEMALE], mood: 'cheerful' },
    },
    brackets: {
      'trance': 'club', 'industrial': 'club', 'deep house': 'club', 'progressive house': 'club', 'afro house': 'club', 'acid house': 'club',
      'dub techno': 'club', 'hardstyle': 'club', 'gabber': 'club', 'happy hardcore': 'club', 'dubstep': 'club', 'uk garage': 'club',
      'big beat': 'club', 'future bass': 'club', 'breakbeat': 'club', 'electro swing': 'club', 'idm': 'mellow', 'glitch': 'club',
      'vaporwave': 'mellow', 'chiptune': 'synth', 'dark ambient': 'mellow', 'drone': 'mellow', 'chillwave': 'mellow', 'witch house': 'urban',
      'footwork': 'urban', 'moombahton': 'club', 'psytrance': 'club', 'drill': 'urban', 'grime': 'urban', 'boom bap': 'urban',
      'dancehall': 'urban', 'reggae': 'groove', 'dub': 'groove', 'reggaeton': 'club', 'afrobeat': 'groove', 'amapiano': 'club',
      'samba': 'groove', 'bossa nova': 'acoustic', 'salsa': 'groove', 'cumbia': 'groove', 'latin': 'groove', 'bhangra': 'club',
      'mariachi': 'band', 'flamenco': 'acoustic', 'tango': 'acoustic', 'celtic': 'acoustic', 'klezmer': 'acoustic', 'fado': 'acoustic',
      'gypsy jazz': 'acoustic', 'ska': 'groove', 'rocksteady': 'groove', 'bluegrass': 'acoustic', 'country': 'acoustic', 'americana': 'acoustic',
      'neo soul': 'groove', 'gospel': 'band', 'blues': 'band', 'jazz fusion': 'band', 'swing': 'groove', 'big band': 'groove',
      'ragtime': 'acoustic', 'doo wop': 'groove', 'motown': 'groove', 'smooth jazz': 'acoustic', 'blues rock': 'band', 'folk rock': 'band',
      'indie folk': 'acoustic', 'punk': 'band', 'post-punk': 'band', 'hardcore punk': 'band', 'pop punk': 'band', 'grunge': 'band',
      'britpop': 'band', 'garage rock': 'band', 'surf rock': 'band', 'progressive rock': 'score', 'hard rock': 'band', 'stoner rock': 'band',
      'gothic rock': 'band', 'new wave': 'band', 'post-rock': 'score', 'shoegaze': 'mellow', 'power metal': 'band', 'death metal': 'band',
      'black metal': 'band', 'symphonic metal': 'band', 'folk metal': 'band', 'metalcore': 'band', 'nu metal': 'urban', 'funk rock': 'groove',
      'rap metal': 'urban', 'disco': 'groove', 'nu-disco': 'club', 'italo disco': 'club', 'french house': 'club', 'city pop': 'groove',
      'k-pop': 'band', 'hyperpop': 'club', 'j-pop': 'band', 'new jack swing': 'urban', 'miami bass': 'urban', 'freestyle': 'club',
      'europop': 'club', 'russian pop': 'band', 'classical': 'score', 'baroque': 'score', 'opera': 'score', 'gregorian': 'score',
      'waltz': 'acoustic', 'march': 'score', 'musical theatre': 'score', 'cabaret': 'acoustic', 'lounge': 'mellow', 'easy listening': 'mellow',
      'lullaby': 'mellow', 'children music': 'band'
    }
  };
  // Слияние с боевыми словарями 26 семей: данные ресёрча — отдельно от логики.
  GENRE_WORDS.push(...STYLE_PACK.genreWords);
  Object.assign(STYLE_ALIASES, STYLE_PACK.aliases);
  Object.assign(RHYTHM_BY_GENRE, STYLE_PACK.rhythm);
  Object.assign(PROD_BY_GENRE, STYLE_PACK.production);
  Object.assign(STYLE_ATMOSPHERE, STYLE_PACK.atmosphere);
  Object.assign(VOCAL_PROFILES, STYLE_PACK.vocal);
  Object.assign(BRACKET_GROUPS, STYLE_PACK.brackets);
  // ==== END STYLE PACK (#45) ====

  const VERSION = '2026-11-23-style45-1';


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
