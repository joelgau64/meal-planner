const NOTION_VERSION = '2022-06-28';
const DB_RECETTES = '39c7b0f8-bf02-4893-bc05-6d82b8c38617';

// Samsung Food URL mapping by recipe name keywords
const SAMSUNG_URLS = [
  ["mafé", "https://app.samsungfood.com/recipes/1017d4e754f36055fd0aafcf86e4c393ef205bac816"],
  ["tortellini skillet", "https://app.samsungfood.com/recipes/101fd4fd38a0907f51351deb5668281c5d5309678db"],
  ["pulled chicken", "https://app.samsungfood.com/recipes/1016196fbf3f6656cfbe3dc29923aaaffe1b9703dd8"],
  ["lentil salad", "https://app.samsungfood.com/recipes/10702f6cbc2384c415daa20b51736e08a6b"],
  ["chickpea salad", "https://app.samsungfood.com/recipes/10110684587155744e1da55100272bcaab825e1682f"],
  ["japchae", "https://app.samsungfood.com/recipes/1012f2b1a31e27ad91a8aa02d87eb97e353ada757e6"],
  ["sea bass", "https://app.samsungfood.com/recipes/1075a92a9efcf26438b80d13dad8eddb670"],
  ["spaghetti bolognese", "https://app.samsungfood.com/recipes/101095da77fa6e6ce11309e765c3d88fbcc2e00d14d"],
  ["thai green curry", "https://app.samsungfood.com/recipes/101e33a38ce3f593bd61fc86cdfdcd909579ab73f47"],
  ["pesto chicken", "https://app.samsungfood.com/recipes/10165cb0d8319e0e678184b4e782cc7012f821c11b0"],
  ["puttanesca", "https://app.samsungfood.com/recipes/101ab297d40fb5c3e0ac14723bd3b41e684f1181671"],
  ["lemongrass chicken", "https://app.samsungfood.com/recipes/1018fbecd7ba41a887632cdee3ff8a5e6ae960f1b87"],
  ["pico de gallo", "https://app.samsungfood.com/recipes/10193b3a3cc10cd6a3a3ee8d0f90e7c34c48e6020ee"],
  ["chicken parmesan", "https://app.samsungfood.com/recipes/101169b172a893ad827983a0d63660c359e3bcb02a7"],
  ["yaki udon", "https://app.samsungfood.com/recipes/101ed79bea4e4ad6cddfcdf3259dfaaac2192b50150"],
  ["rigatoni", "https://app.samsungfood.com/recipes/1011a21c281f91bd6ea5a9b0f1df4b86b3b67fad0a7"],
  ["salmon bowl", "https://app.samsungfood.com/recipes/101140ad772dd639e69c6849819180c6c82b9d875bb"],
  ["marry me chicken", "https://app.samsungfood.com/recipes/101f69cca290dce32c3269279a90c0388eab405a619"],
  ["shawarma", "https://app.samsungfood.com/recipes/1018f4efe37504be8ce9ea1d13eba1e8df2d5eb7b09"],
  ["sheet pan chicken", "https://app.samsungfood.com/recipes/101c864cb469fa3e341248264de0e020a1ff45a17d0"],
  ["beef tacos", "https://app.samsungfood.com/recipes/101acb361eba7e206ef7949894c6492ee7ee7579ae3"],
  ["wrap saumon", "https://app.samsungfood.com/recipes/1016fda164b4fa0a696fc74f1448cb471c90ddee139"],
  ["wrap poulet", "https://app.samsungfood.com/recipes/101d57cb94ce9bd9d1ef552353693ad04744a3f3f65"],
  ["piccata", "https://app.samsungfood.com/recipes/10105084f053f4d0d867248c05ca74524ba31deae3c"],
  ["kakiage", "https://app.samsungfood.com/recipes/107018c0f832ad97a1a8421ef455adc7cff"],
  ["buffalo", "https://app.samsungfood.com/recipes/107450c5354c8db48cdb20a8e10d975c0d0"],
  ["patatas bravas", "https://app.samsungfood.com/recipes/107f0be828869b54829b5ed6e2f34996827"],
  ["kfc", "https://app.samsungfood.com/recipes/101837a0aedfd17b57524fc7a1e99fa2fd588766e04"],
  ["tandoori", "https://app.samsungfood.com/recipes/1010e55f6f01d35b38abf76a7c0abc9a12874642694"],
  ["cabillaud purée carotte", "https://app.samsungfood.com/recipes/101ead754a57aa415a3733fe50f6dd2ddc7c065a832"],
  ["sirop érable", "https://app.samsungfood.com/recipes/10179e5db671cf1b4d94afd1e8e401bde2a37bc7219"],
  ["kefta", "https://app.samsungfood.com/recipes/101ffcacd667f3d91d0de2c6fd134db934e1e80fc11"],
  ["linguine thon", "https://app.samsungfood.com/recipes/1010f6dc04fc8024b1dcc7135ff20b38f373e1147c3"],
  ["faux-filet", "https://app.samsungfood.com/recipes/1018fb1615536d98f94a0cf8fe3cc6d8c369593d24e"],
  ["ratatouille", "https://app.samsungfood.com/recipes/101c8ec39a83315dcc8f36eb35a84b11035a260e0db"],
  ["crozets", "https://app.samsungfood.com/recipes/10173ad0c9671c37ec8c778649563a6ea258a8231d4"],
  ["linguine saumon", "https://app.samsungfood.com/recipes/101c089df3d576ba1e038e6797807dd73f8d75a0b4b"],
  ["pappardelle", "https://app.samsungfood.com/recipes/101149c4792bd8b6e0a7f29bf723355b73979170448"],
  ["haricots verts viande", "https://app.samsungfood.com/recipes/101709eddb0da37d57954fe1c88ef393e61846e5f64"],
  ["galette forestière", "https://app.samsungfood.com/recipes/101153853aa382c071e4d2f20e0f51777c3504b1324"],
  ["dakgangjeong", "https://app.samsungfood.com/recipes/10193cf4d219071b211497c5a9d8d90a84a6fc572cd"],
  ["rôti boeuf", "https://app.samsungfood.com/recipes/1014a871884c181f7aecb3dc3d2b86000889aac1cf9"],
  ["boulettes poisson", "https://app.samsungfood.com/recipes/101ef646d5bb362a7099edde26353928ea5ad38ca95"],
  ["soupe lentilles", "https://app.samsungfood.com/recipes/10162c1e63665a323ca5283b8fc66efe36f1d189233"],
  ["filet mignon balsamique", "https://app.samsungfood.com/recipes/101185679c484de2ff6020997eddf04a4175f8bdea5"],
  ["saumon mariné patate douce", "https://app.samsungfood.com/recipes/101bdb78085bcc6449323088b5585e0e700b2b4cebf"],
  ["brick thon", "https://app.samsungfood.com/recipes/1010cf3749e7ebf263c0afb7ac4cb803ee9f8bf4668"],
  ["porc caramel", "https://app.samsungfood.com/recipes/10172eaaac08d743fc58db48b914328a6edb1d08c41"],
  ["butternut châtaignes", "https://app.samsungfood.com/recipes/1012488585fce87928f551453136acb715ad6645aac"],
  ["poulet coco curry", "https://app.samsungfood.com/recipes/1013c6e902db65166781c3ce1a1296699775fa52d49"],
  ["chili con carne", "https://app.samsungfood.com/recipes/101798cf870440d6cf66164dab4b8a61e1a1ab17d72"],
  ["parmentier canard", "https://app.samsungfood.com/recipes/1016728604014ac7657a862d89295e71e0505fba2b5"],
  ["cake jambon olives", "https://app.samsungfood.com/recipes/101cfcd177bd842390fa174314db2b522030ae76967"],
  ["veau chorizo", "https://app.samsungfood.com/recipes/1017762012c2979e92f3977546d31825a94884d1f98"],
  ["filet mignon croûte", "https://app.samsungfood.com/recipes/1015b4c85238752184e6fb91a6879f602d8dd1809cf"],
  ["courge spaghetti", "https://app.samsungfood.com/recipes/101fdd6f04366dbe035ab8898ed52204d6f9a70c69c"],
  ["tom kha", "https://app.samsungfood.com/recipes/101ac212b50cc1d23c70e69187a6ae3d39f7279f79d"],
  ["truite", "https://app.samsungfood.com/recipes/10736014d39acfc481caa6d5330bbed3537"],
  ["bavette", "https://app.samsungfood.com/recipes/101f44ce190b544a8ada1cfdc29315e196e1b67afc9"],
  ["canard orange", "https://app.samsungfood.com/recipes/101857d723f32c51ed6cd1ea1c079f8df009808c87c"],
  ["chakchouka", "https://app.samsungfood.com/recipes/101e68d8814a7323d730e93a4190281932e5d510209"],
  ["pâtes courge", "https://app.samsungfood.com/recipes/101c2dd88f59852be04f5b50ebd9bf7bb965a3e4008"],
  ["magret", "https://app.samsungfood.com/recipes/101d13dbcb0b9cf32576277e3271fd2c6757a242a32"],
  ["parmigiana", "https://app.samsungfood.com/recipes/1019cd40049432d5ffb1c7a1992a43ab8dcfd0ce4a8"],
  ["quiche artichaut", "https://app.samsungfood.com/recipes/10186c1390d84cf346de12b017d1689d005bbcd4633"],
  ["quiche saumon poireau", "https://app.samsungfood.com/recipes/101614d025eff90c181e616f44fb9ea8af37aa97fb3"],
  ["tarte courgettes thon", "https://app.samsungfood.com/recipes/1012fdcacf50747c755d2b17212c44d51be58d9aca4"],
  ["taboulé", "https://app.samsungfood.com/recipes/10144d17d847f7d2252c4ac89c9ff910c7001f4882b"],
  ["tarte légumes rôtis", "https://app.samsungfood.com/recipes/1012abc086f35c513759007f9b593a5fd498ec5a226"],
  ["sarrasin saumon", "https://app.samsungfood.com/recipes/101ecee260f37aae3567f36fa6c330d01c661202606"],
  ["cabillaud fenouil", "https://app.samsungfood.com/recipes/10140cd4c8c905102e4ac5e8f48644dca8ec0b2885f"],
  ["stuffed shells", "https://app.samsungfood.com/recipes/1019b6b15f68e92b0a28cf90bef3007713d716c9626"],
  ["stuffed peppers", "https://app.samsungfood.com/recipes/101ac4198575ea59baf0b4d0ae093eea3f5d353e859"],
  ["gyros", "https://app.samsungfood.com/recipes/101d9000ec19be725311f1ddef8d331b1beb77177b7"],
  ["teriyaki salmon", "https://app.samsungfood.com/recipes/1010de6b7befb143dd9d466f0cec95a40bff274fe12"],
  ["pork tenderloin honey", "https://app.samsungfood.com/recipes/101cae2c5079d18a73fd3eb010e03699081b7dfd1aa"],
  ["minestrone", "https://app.samsungfood.com/recipes/1019db8081bc96d22d78fe7973d794ed28929199dc8"],
  ["teriyaki poulet", "https://app.samsungfood.com/recipes/1010623e40ca626445be62ea18d5711db1db22664dc"],
  ["moussaka", "https://app.samsungfood.com/recipes/1011212028ff0424832e758cac203584ccfae53d386"],
  ["riz frit thaïlandais", "https://app.samsungfood.com/recipes/101a08787d2389cda7724f1de327503627de548a2ee"],
  ["salade tortellini", "https://app.samsungfood.com/recipes/101552433828f875fd9ba1e14897eb52b92a5a5b49a"],
  ["cabillaud parmesan", "https://app.samsungfood.com/recipes/101724e656ea13fb12dc934fb1439c1e862e11dc441"],
  ["quesadillas", "https://app.samsungfood.com/recipes/1010287c38b09e39a40ae067740c236ba5a93672829"],
  ["boulettes toscane", "https://app.samsungfood.com/recipes/101b8f4eba419b7d8c064ab59973ba1a046c3639c75"],
  ["wok cacahuète", "https://app.samsungfood.com/recipes/101d77ce15eef79aee8f728240781f5fd32db074de8"],
  ["galette complète", "https://app.samsungfood.com/recipes/101051898f77ffc6fde2b5aa71bf2d008bf2d0fd681"],
  ["lasagne", "https://app.samsungfood.com/recipes/101f2ba5438d13c08d6b3dd248a439fcfcc561dc97a"],
  ["tonkatsu", "https://app.samsungfood.com/recipes/101474018d943f9959132ae1a71eae18fc89d289bae"],
  ["basquaise", "https://app.samsungfood.com/recipes/1010d5f18e03ee4bae32ebccce1772d358cb37c4eab"],
  ["penne gigi", "https://app.samsungfood.com/recipes/1019669ab4ed7560d3fc1cfa0e3bb02902cdd2126c8"],
  ["blanquette poulet", "https://app.samsungfood.com/recipes/10776f91235c23a428891d9649ef547a8d8"],
  ["tajine olives citrons", "https://app.samsungfood.com/recipes/1073be2a704afa042918535df00b8f27912"],
  ["cashew chicken", "https://app.samsungfood.com/recipes/1019c0ed9f835980fead4d01e4e2649f33cd769c8ed"],
  ["orange chicken", "https://app.samsungfood.com/recipes/107e5d9de7379c24aab9c565a693c197c9c"],
  ["quiche poireaux saumon", "https://app.samsungfood.com/recipes/101bcf998841b04d20cc801d438d00342c3194a8362"],
  ["drunken noodles", "https://app.samsungfood.com/recipes/1010fcc5f56fa0f27655d17b35f1a392b89bfa98fb0"],
  ["dahl lentilles", "https://app.samsungfood.com/recipes/1078b4263c63065449993f2ec694280d661"],
  ["tataki", "https://app.samsungfood.com/recipes/107018c0a84b9ac77d2b6cb0367e3205761"],
  ["rougail", "https://app.samsungfood.com/recipes/1071e2a182450c940dea3e557ab8dcc4047"],
  ["galettes courgettes", "https://app.samsungfood.com/recipes/10725ee1690aaa140cbabdd08e83b675e1f"],
  ["falafel", "https://app.samsungfood.com/recipes/101a429e6e006c0c67da346be759f5339c5c030f1c8"],
  ["carbonara", "https://app.samsungfood.com/recipes/101bc2616bbe0f58d4415ceda2deaaccedd18fb46b9"],
];

async function fetchOgImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
    const html = await res.text();
    const match = html.match(/meta-og:image:\s*(https:\/\/[^\s\n]+)/);
    if (match) return match[1];
    // Try standard HTML meta tag
    const match2 = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (match2) return match2[1];
    const match3 = html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (match3) return match3[1];
    return null;
  } catch { return null; }
}

const PEXELS_API_KEY = '4g2jiEPcHQiYGhnNjrviL0NacwVzxAKrQ7qokCncr1lauq2ARQdhTRFp';

const TR = {
  'poulet':'chicken','boeuf':'beef','porc':'pork','saumon':'salmon',
  'cabillaud':'cod fish','merlu':'hake','bar':'sea bass','thon':'tuna',
  'crevettes':'shrimp','pâtes':'pasta','farfalle':'pasta','orecchiette':'pasta',
  'nouilles':'noodles','riz':'rice','curry':'curry','salade':'salad',
  'soupe':'soup','tarte':'tart','tomate':'tomato','champignon':'mushroom',
  'quinoa':'quinoa','citron':'lemon','épinards':'spinach','courgette':'zucchini',
  'aubergine':'eggplant','artichaut':'artichoke','petits pois':'peas',
  'jambon':'ham','bacon':'bacon','mozzarella':'mozzarella','pesto':'pesto',
  'citronnelle':'lemongrass','olives':'olives','cappuccino':'mushroom soup',
  'tatin':'tart tomato','roulés':'fish rolls','brocoli':'broccoli',
  'pommes de terre':'potatoes','lait de coco':'coconut curry'
};

async function findPhotoPexels(nom) {
  let q = nom.toLowerCase();
  for (const [fr, en] of Object.entries(TR)) q = q.replace(new RegExp(fr, 'gi'), en);
  q = q.replace(/\b(au|aux|à|la|le|les|de|du|des|et|en|avec|sur|ma|mon|sa|ses)\b/gi, ' ');
  q = q.replace(/\s+/g, ' ').trim() + ' food dish';
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=5&orientation=landscape`;
  const res = await fetch(url, { headers: { 'Authorization': PEXELS_API_KEY } });
  const data = await res.json();
  return data.photos?.[0]?.src?.large2x || data.photos?.[0]?.src?.large || null;
}

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

function findMatch(recipeName, urls) {
  const normName = normalize(recipeName);
  for (const [keyword, url] of urls) {
    const normKey = normalize(keyword);
    const keyWords = normKey.split(/\s+/);
    if (keyWords.every(w => normName.includes(w))) {
      return url;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  
  try {
    // 1. Get all recipes from Notion
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${DB_RECETTES}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 200 }),
    });
    const notionData = await notionRes.json();
    const recipes = notionData.results || [];

    const results = { updated: 0, skipped: 0, failed: 0, log: [] };

    for (const page of recipes) {
      // Skip if already has photo
      if (page.properties?.Photo?.url) { results.skipped++; continue; }

      const name = page.properties?.Nom?.title?.[0]?.plain_text || '';
      const samsungUrl = findMatch(name, SAMSUNG_URLS);
      
      let imageUrl = null;

      if (samsungUrl) {
        // Essayer Samsung Food d'abord
        imageUrl = await fetchOgImage(samsungUrl);
      }

      // Fallback Pexels si pas d'image Samsung Food
      if (!imageUrl) {
        imageUrl = await findPhotoPexels(name);
      }

      if (!imageUrl) {
        results.log.push(`No image: ${name}`);
        results.failed++;
        continue;
      }

      // Update Notion
      await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { Photo: { url: imageUrl } } }),
      });
      results.updated++;
      results.log.push(`✓ ${name}`);
    }

    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
