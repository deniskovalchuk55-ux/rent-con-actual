// Категорія витрати з банку: за назвою магазину і кодом MCC → одна з твоїх категорій Expense·Control.
// Чистий модуль без залежностей: використовують і сервер (вебхук), і застосунок (перегляд імпорту).

// words — корені слів, за якими шукаємо твою категорію (у нижньому регістрі);
// shops — фрагменти назв магазинів (польські, українські й міжнародні мережі)
const GROUPS = [
  { key: 'groceries', mcc: [5411, 5412, 5422, 5441, 5451, 5462, 5499, 5297, 5298, 5300, 5331],
    words: ['продукт', 'супермаркет', 'харч', 'їжа', 'grocer', 'food', 'spożyw', 'zakup'],
    shops: ['biedronka', 'lidl', 'żabka', 'zabka', 'auchan', 'carrefour', 'kaufland', 'netto', 'dino ', 'stokrotka', 'aldi', 'lewiatan', 'polomarket', 'intermarche', 'spar ', 'delikatesy', 'frisco', 'сільпо', 'silpo', 'атб', 'atb-', 'novus', 'фора', 'варус', 'varus', 'ашан', 'metro '] },
  { key: 'cafe', mcc: [5811, 5812, 5813, 5814],
    words: ['кафе', 'ресторан', 'кав', 'обід', 'фастфуд', 'доставка', 'restaur', 'cafe', 'coffee', 'jedzenie'],
    shops: ['mcdonald', 'kfc', 'burger king', 'starbucks', 'costa coffee', 'pizza', 'sushi', 'glovo', 'wolt', 'uber eats', 'pyszne', 'bolt food', 'kebab', 'domino', 'subway', 'max premium', 'north fish', 'puzata', 'пузата', 'aroma kava', 'львівські круасани'] },
  { key: 'transport', mcc: [4111, 4112, 4121, 4131, 4411, 4457, 4468, 4784, 4789, 7512, 7513, 7519, 7523],
    words: ['транспорт', 'таксі', 'проїзд', 'метро', 'поїзд', 'taxi', 'transport', 'bilet'],
    shops: ['uber', 'bolt.eu', 'bolt ', 'freenow', 'free now', 'jakdojade', 'mpk', 'ztm', 'pkp', 'intercity', 'koleo', 'flixbus', 'uklon', 'уклон', 'укрзалізниц', 'uz.gov', 'skycash', 'mobilet'] },
  { key: 'fuel', mcc: [5541, 5542, 5172, 5983, 7531, 7534, 7535, 7538, 7542, 7549, 5532, 5533],
    words: ['пальн', 'бензин', 'заправ', 'авто', 'машин', 'fuel', 'paliwo', 'samoch'],
    shops: ['orlen', 'circle k', 'shell', 'lotos', 'moya', 'amic', ' bp ', 'bp-', 'окко', 'okko', 'wog', 'socar', 'upg', 'avias'] },
  { key: 'health', mcc: [5122, 5912, 5975, 5976, 8011, 8021, 8031, 8041, 8042, 8043, 8044, 8049, 8050, 8062, 8071, 8099],
    words: ['здоров', 'аптек', 'медиц', 'лік', 'стомат', 'health', 'pharm', 'apteka', 'zdrow', 'medy'],
    shops: ['apteka', 'super-pharm', 'doz.pl', 'gemini', 'luxmed', 'medicover', 'enel-med', 'аптека', 'подорожник', 'анц'] },
  { key: 'beauty', mcc: [5977, 7230, 7297, 7298],
    words: ['краса', 'космет', 'догляд', 'перукар', 'салон', 'beauty', 'kosmet', 'uroda'],
    shops: ['rossmann', 'hebe', 'douglas', 'sephora', 'notino', 'eva.ua', 'prostor', 'watsons'] },
  { key: 'clothes', mcc: [5137, 5139, 5611, 5621, 5631, 5641, 5651, 5655, 5661, 5681, 5691, 5697, 5698, 5699, 5931, 5948],
    words: ['одяг', 'взутт', 'шопінг', 'clothes', 'ubran', 'odzie'],
    shops: ['zara', 'h&m', 'reserved', 'pull&bear', 'bershka', 'stradivarius', 'mohito', 'house ', 'cropp', 'sinsay', 'ccc ', 'deichmann', 'primark', 'zalando', 'answear', 'lpp ', 'mango', 'uniqlo', 'about you'] },
  { key: 'home', mcc: [5021, 5039, 5065, 5200, 5211, 5231, 5251, 5261, 5712, 5713, 5714, 5718, 5719, 5722, 5732, 5733, 5734, 5735, 5045, 5046],
    words: ['дім', 'побут', 'господар', 'ремонт', 'меблі', 'техні', 'home', 'dom', 'mieszk'],
    shops: ['ikea', 'leroy', 'castorama', 'obi ', 'jysk', 'pepco', 'action ', 'tedi', 'media expert', 'rtv euro', 'mediamarkt', 'media markt', 'x-kom', 'morele', 'епіцентр', 'epicentr', 'rozetka', 'розетка', 'comfy', 'фокстрот', 'allegro', 'temu', 'aliexpress', 'amazon'] },
  { key: 'utilities', mcc: [4814, 4816, 4821, 4899, 4900, 9402],
    words: ['комунал', 'звʼязок', "зв'язок", 'звязок', 'інтернет', 'телефон', 'мобільн', 'оренд', 'utilit', 'rachun', 'czynsz'],
    shops: ['play ', 'orange', 't-mobile', 'plus gsm', 'heyah', 'київстар', 'kyivstar', 'vodafone', 'lifecell', 'pge', 'tauron', 'enea', 'energa', 'pgnig', 'veolia', 'upc ', 'vectra', 'netia'] },
  { key: 'subscriptions', mcc: [5815, 5816, 5817, 5818, 5968, 7372],
    words: ['підписк', 'сервіс', 'subscri', 'abonam'],
    shops: ['netflix', 'spotify', 'youtube', 'apple.com', 'itunes', 'google', 'icloud', 'openai', 'chatgpt', 'anthropic', 'claude.ai', 'disney', 'hbo', 'max.com', 'megogo', 'sweet.tv', 'canva', 'notion', 'adobe', 'microsoft', 'telegram premium', 'patreon'] },
  { key: 'fun', mcc: [7832, 7841, 7911, 7922, 7929, 7932, 7933, 7991, 7992, 7993, 7994, 7996, 7998, 7999, 5813],
    words: ['розваг', 'кіно', 'відпоч', 'дозвіл', 'хобі', 'entertain', 'rozryw', 'kino'],
    shops: ['cinema city', 'multikino', 'helios', 'steam', 'playstation', 'xbox', 'nintendo', 'planeta kino', 'multiplex', 'ticketmaster', 'eventim', 'ebilet', 'concert'] },
  { key: 'education', mcc: [5942, 5943, 8211, 8220, 8241, 8244, 8249, 8299],
    words: ['освіт', 'навчан', 'курс', 'книг', 'educat', 'nauk', 'eduk', 'książ'],
    shops: ['udemy', 'coursera', 'empik', 'skillshare', 'duolingo', 'yakaboo', 'книгарн'] },
  { key: 'travel', mcc: [3000, 3001, 3005, 3007, 3008, 3009, 3010, 3016, 3024, 3051, 3058, 3066, 3075, 3501, 3502, 3503, 3504, 3509, 3512, 3530, 3533, 4511, 4582, 4722, 7011, 7032, 7033],
    words: ['подорож', 'відпуст', 'готел', 'авіа', 'квитк', 'travel', 'podróż', 'wakac'],
    shops: ['booking', 'airbnb', 'ryanair', 'wizz', 'lot.com', 'lot polish', 'skyup', 'easyjet', 'hotel', 'hostel', 'trivago', 'expedia'] },
  { key: 'gifts', mcc: [5947, 5992, 5944],
    words: ['подарун', 'квіт', 'gift', 'prezent', 'kwiat'],
    shops: ['kwiaciarnia', 'flowwow', 'apart'] },
  { key: 'pets', mcc: [742, 5995],
    words: ['тварин', 'кіт', 'кот', 'собак', 'pet', 'zwierz'],
    shops: ['zooplus', 'maxi zoo', 'kakadu', 'zoo '] },
  { key: 'kids', mcc: [5641, 5945, 8351],
    words: ['діт', 'дит', 'kids', 'dzieci'],
    shops: ['smyk', 'toys', 'lego'] },
  { key: 'sport', mcc: [5655, 5940, 5941, 7941, 7997],
    words: ['спорт', 'фітнес', 'зал', 'sport', 'fitness', 'siłown'],
    shops: ['decathlon', 'multisport', 'zdrofit', 'calypso', 'mcfit', 'sportisimo', 'sport life', 'go21'] },
];

const FALLBACK_WORDS = ['інше', 'різне', 'без категор', 'other', 'misc', 'inne', 'різні', 'загальн'];
const MCC_TO_GROUP = new Map();
for (const g of GROUPS) for (const m of g.mcc) if (!MCC_TO_GROUP.has(m)) MCC_TO_GROUP.set(m, g.key);

const lower = s => String(s || '').toLowerCase().replace(/[’ʼ`]/g, "'");

// група витрати за назвою магазину, потім за MCC (діапазони авіа й готелів — окремо)
function groupOf({ title, mcc } = {}) {
  const t = ' ' + lower(title) + ' ';
  for (const g of GROUPS) if (g.shops.some(s => t.includes(s))) return g.key;
  const m = Number(mcc) || 0;
  if (MCC_TO_GROUP.has(m)) return MCC_TO_GROUP.get(m);
  if ((m >= 3000 && m <= 3350) || m === 4511) return 'travel';
  if (m >= 3351 && m <= 3999) return 'travel';
  return null;
}

// categories: [{ id, name }] — твої категорії (і спільні) з Expense·Control
function suggestCategory(tx, categories) {
  const cats = (categories || []).map(c => ({ ...c, n: lower(c.name) }));
  if (!cats.length) return null;
  const g = groupOf(tx);
  if (g) {
    const words = GROUPS.find(x => x.key === g).words;
    let best = null, bestLen = 0;
    for (const c of cats) for (const w of words) if (c.n.includes(w) && w.length > bestLen) { best = c; bestLen = w.length; }
    if (best) return best.id;
  }
  const fb = cats.find(c => FALLBACK_WORDS.some(w => c.n.includes(w)));
  return fb ? fb.id : null;
}

// Що це за операція: справжня витрата чи переказ/готівка/надходження (їх не імпортуємо як витрати)
const CASH_MCC = new Set([6010, 6011]);
// перекази, поповнення, купівля криптовалюти/цінних паперів — це рух власних грошей, а не витрата
const TRANSFER_MCC = new Set([4829, 6012, 6050, 6051, 6211, 6536, 6537, 6538, 6540]);
function kindOf({ amount, mcc, title } = {}) {
  const a = Number(amount) || 0;
  if (a > 0) return 'income';
  const m = Number(mcc) || 0;
  if (CASH_MCC.has(m)) return 'cash';
  if (TRANSFER_MCC.has(m)) return 'transfer';
  const t = lower(title);
  if (/^(з|на) (гривнев|доларов|євро|eur|usd)|^переказ (на|з) (свою|власн)|^з банки|^на банку|^поповнення «|^обмін валют/.test(t)) return 'transfer';
  return 'expense';
}

module.exports = { GROUPS, groupOf, suggestCategory, kindOf };
