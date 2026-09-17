import * as cheerio from "cheerio";

export const SLOT_DEFINITIONS = [
  {
    oldUrl: "https://judiedude.store/lazy-cat-nope-not-today/unisex-standard-t-shirt?color=red",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/a92750d5-fca8-ff2b-fadd-1732dfcbb1b7.png",
    titleId: "d50"
  },
  {
    oldUrl: "https://judiedude.store/cat-owner-quote-personal-cat-servant/unisex-standard-t-shirt?color=sand",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/4762c8b3-feca-4211-b891-bf03eb948d4e.png",
    titleId: "d27"
  },
  {
    oldUrl: "https://judiedude.store/gothic-cat-quote/unisex-standard-t-shirt?color=white",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/c2dbe68c-8333-6cd6-8c8a-0902f66a31d8.png",
    titleId: "d28"
  },
  {
    oldUrl: "https://judiedude.store/tuxedo-cat-valentine-heart/unisex-standard-t-shirt",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/453dd057-fe62-9f57-5276-1d54c9b0de93.png",
    titleId: "d32"
  },
  {
    oldUrl: "https://judiedude.store/retro-husband-of-a-crazy-cat-lady/unisex-standard-t-shirt?color=forest+green",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/51f36139-fe05-85d7-8b7c-9cc3288e2ff4.png",
    titleId: "d36"
  },
  {
    oldUrl: "https://judiedude.store/personal-cat-servant-2/unisex-standard-t-shirt?color=navy",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/0143d44e-f53c-3423-bb05-024340ed2f3b.png",
    titleId: "d42"
  },
  {
    oldUrl: "https://judiedude.store/funny-cats-saying/unisex-standard-t-shirt?color=irish+green",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/ad51a371-8527-9bc1-e7fa-b74888d2fdcf.png",
    titleId: "d46"
  },
  {
    oldUrl: "https://judiedude.store/funny-cat-middle-finger-hilarious-cat-in-the-car/unisex-standard-t-shirt?color=royal",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/05493aa0-6ee5-946d-ccba-e6c9cfd452a9.png",
    titleId: "d55"
  },
  {
    oldUrl: "https://judiedude.store/en-gb/cat-biting-shark-1/unisex-standard-t-shirt?color=charcoal",
    oldImage: "https://mcusercontent.com/2eefdbe71a5b74c84805c1a7f/images/cea55169-1a36-829a-9d3f-b720af507347.png",
    titleId: "d59"
  }
];

const OLD_SEE_MORE_URL = "https://judiedude.store/collection/cat?sort=newest&page=2";
const GENERIC_PRODUCT_SEGMENTS = new Set([
  "product", "products", "item", "items", "shop",
  "unisex-standard-t-shirt", "premium-t-shirt", "classic-t-shirt",
  "hoodie", "sweatshirt", "tank-top", "poster", "mug"
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim(), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function bestFromSrcset(value) {
  if (!value) return "";
  const candidates = String(value)
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates.at(-1) || "";
}

function imageFrom($, anchor, card, baseUrl) {
  const image = anchor.find("img").first().length
    ? anchor.find("img").first()
    : card.find("img").first();

  if (!image.length) return "";

  const source = image.closest("picture").find("source").last();
  const candidates = [
    image.attr("data-src"),
    image.attr("data-original"),
    image.attr("data-lazy-src"),
    bestFromSrcset(image.attr("data-srcset")),
    bestFromSrcset(image.attr("srcset")),
    bestFromSrcset(source.attr("srcset")),
    image.attr("src")
  ];

  for (const candidate of candidates) {
    if (!candidate || /^data:image/i.test(candidate)) continue;
    const resolved = absoluteUrl(candidate, baseUrl);
    if (resolved) return resolved;
  }
  return "";
}

function titleFromUrl(url) {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  let slug = segments.at(-1) || "Product";
  if (GENERIC_PRODUCT_SEGMENTS.has(slug.toLowerCase()) && segments.length > 1) {
    slug = segments.at(-2);
  }
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleFrom($, anchor, card, url) {
  const imageAlt = cleanText(anchor.find("img").first().attr("alt") || card.find("img").first().attr("alt"));
  const aria = cleanText(anchor.attr("aria-label") || anchor.attr("title"));
  const heading = cleanText(card.find("h1,h2,h3,h4,[class*='title'],[data-testid*='title']").first().text());
  const anchorText = cleanText(anchor.clone().find("script,style,svg").remove().end().text());

  for (const candidate of [imageAlt, aria, heading, anchorText]) {
    if (!candidate || candidate.length < 2 || candidate.length > 140) continue;
    if (/^(buy now|shop now|view|details|learn more)$/i.test(candidate)) continue;
    return candidate;
  }
  return titleFromUrl(url);
}

function productKey(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.href;
}

function looksLikeProduct(url, anchor, card, image, collectionUrl) {
  const parsed = new URL(url);
  const collection = new URL(collectionUrl);
  const path = parsed.pathname.toLowerCase();
  if (parsed.origin !== collection.origin) return false;
  if (parsed.href === collection.href || path === "/" || path === collection.pathname.toLowerCase()) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip)$/i.test(path)) return false;
  if (/\/(collection|collections|category|categories|search|cart|account|login|privacy|terms|blog|pages?)(\/|$)/i.test(path)) return false;
  if (/\/products?\//i.test(path)) return true;

  const productHint = cleanText(
    (anchor.attr("class") || "") + " " +
    (card.attr("class") || "") + " " +
    (card.attr("data-product-id") || "")
  );
  const depth = path.split("/").filter(Boolean).length;
  return Boolean(image && depth >= 1 && /product|item|tile|card|design|shirt|tee|hoodie|mug|poster/i.test(productHint + " " + path));
}

function schemaProducts($, baseUrl) {
  const products = [];

  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;

    if (node.itemListElement) {
      node.itemListElement.forEach((entry) => visit(entry.item || entry));
    }

    const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : node["@type"];
    if (String(type || "").toLowerCase().includes("product")) {
      const rawImage = Array.isArray(node.image)
        ? node.image[0]
        : (node.image && typeof node.image === "object" ? node.image.url : node.image);
      const url = absoluteUrl(node.url || node["@id"], baseUrl);
      if (url) {
        products.push({
          url,
          image: absoluteUrl(rawImage, baseUrl),
          title: cleanText(node.name) || titleFromUrl(url)
        });
      }
    }

    if (node["@graph"]) visit(node["@graph"]);
  }

  $("script[type='application/ld+json']").each((_, element) => {
    try {
      visit(JSON.parse($(element).text()));
    } catch {
      // Ignore invalid structured data.
    }
  });
  return products;
}

export function extractProducts(html, collectionUrl, limit = 9) {
  const $ = cheerio.load(html);
  const found = [];
  const seen = new Set();

  function add(product) {
    if (!product.url) return;
    const key = productKey(product.url);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({
      url: product.url,
      image: product.image || "",
      title: cleanText(product.title) || titleFromUrl(product.url)
    });
  }

  $("a[href]").each((_, element) => {
    if (found.length >= limit) return;
    const anchor = $(element);
    const url = absoluteUrl(anchor.attr("href"), collectionUrl);
    if (!url) return;

    const card = anchor.closest("article,li,[data-product-id],[class*='product'],[class*='item'],[class*='tile'],[class*='card']").first();
    const scope = card.length ? card : anchor;
    const image = imageFrom($, anchor, scope, collectionUrl);
    if (!looksLikeProduct(url, anchor, scope, image, collectionUrl)) return;

    add({
      url,
      image,
      title: titleFrom($, anchor, scope, url)
    });
  });

  if (found.length < limit) {
    for (const product of schemaProducts($, collectionUrl)) {
      if (found.length >= limit) break;
      add(product);
    }
  }

  return found.slice(0, limit);
}

export function extractCollectionTitle(html, collectionUrl) {
  const $ = cheerio.load(html);
  const candidates = [
    $("meta[property='og:title']").attr("content"),
    $("h1").first().text(),
    $("title").text()
  ];
  for (const candidate of candidates) {
    const value = cleanText(candidate).split(/\s+[|–—]\s+/)[0];
    if (value && value.length <= 100) return value;
  }

  const path = new URL(collectionUrl).pathname.split("/").filter(Boolean);
  return (path.at(-1) || "Latest collection")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function extractProductMeta(html, productUrl) {
  const $ = cheerio.load(html);
  const rawImage =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    $("main img").first().attr("src") ||
    $("img").first().attr("src");

  const title =
    cleanText($("meta[property='og:title']").attr("content")) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").text()).split(/\s+[|–—]\s+/)[0] ||
    titleFromUrl(productUrl);

  return {
    url: productUrl,
    image: absoluteUrl(rawImage, productUrl),
    title
  };
}

function titleCase(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function generateCopy(collectionTitle, products, collectionUrl) {
  const titles = products.map((product) => product.title).join(" ");
  const haystack = (collectionTitle + " " + titles + " " + collectionUrl).toLowerCase();

  if (/\b(cat|cats|kitten|kitty|feline)\b/.test(haystack)) {
    return {
      subjects: [
        "Your Cat Would Approve 😺",
        "This Shirt Is So You, Cat Lover",
        "Warning: Cat People Will Notice 👀",
        "Your Cat Has Something to Say…"
      ],
      subject: "Your Cat Would Approve 😺",
      preheader: "Nine cat-inspired designs picked for people who proudly serve their tiny house boss.",
      kicker: "Our latest collection blends cat humor with everyday style.",
      headline: "Life Is Better With Cats 🐾",
      body: "For the people who believe cats aren’t just pets — they’re family, roommates, little weirdos, and somehow the real boss of the house. 😹"
    };
  }

  if (/\b(dog|dogs|puppy|pup|canine)\b/.test(haystack)) {
    return {
      subjects: [
        "Your Dog Would Pick These 🐶",
        "New Looks for Proud Dog People",
        "Warning: Dog Lovers Will Notice 👀",
        "Wear Your Dog-Person Energy"
      ],
      subject: "Your Dog Would Pick These 🐶",
      preheader: "Nine playful designs made for people whose best friend has four paws.",
      kicker: "Fresh designs inspired by loyal companions and everyday adventures.",
      headline: "Life Is Better With Dogs 🐾",
      body: "For the people who know a dog is never just a pet — they’re family, adventure buddy, personal shadow, and the happiest hello at the end of the day."
    };
  }

  const urlTheme = new URL(collectionUrl).pathname.split("/").filter(Boolean).at(-1) || "new arrivals";
  const theme = titleCase(
    cleanText(collectionTitle || urlTheme)
      .replace(/\b(collection|products?|shop)\b/gi, "")
      .replace(/[-_]+/g, " ")
  ) || "New Arrivals";

  return {
    subjects: [
      "New " + theme + " Favorites Just Landed ✨",
      "Nine Fresh Finds Worth Seeing",
      "Your Next Favorite Is Here",
      "A New Collection Made to Stand Out"
    ],
    subject: "New " + theme + " Favorites Just Landed ✨",
    preheader: "Explore nine standout picks from our latest " + theme.toLowerCase() + " collection.",
    kicker: "Our latest collection brings fresh personality to everyday style.",
    headline: theme + " Made to Be Noticed ✨",
    body: "Meet nine fresh designs selected for people who like their style personal, expressive, and a little different from everything else."
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceAllLiteral(source, from, to) {
  return source.split(from).join(to);
}

function replaceTextBlock(html, id, innerHtml) {
  const expression = new RegExp("(<div\\b[^>]*\\bid=[\"']" + id + "[\"'][^>]*>)[\\s\\S]*?(</div>)", "i");
  if (!expression.test(html)) {
    throw new Error("Template block #" + id + " was not found.");
  }
  return html.replace(expression, "$1" + innerHtml + "$2");
}

export function renderEmail(template, input) {
  const products = Array.isArray(input.products) ? input.products.slice(0, 9) : [];
  if (products.length !== 9) {
    throw new Error("Exactly 9 products are required to render the email.");
  }

  let html = String(template || "");
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  SLOT_DEFINITIONS.forEach((slot, index) => {
    const product = products[index];
    if (!product.url || !product.image || !product.title) {
      throw new Error("Product " + (index + 1) + " is missing a URL, image, or title.");
    }

    html = replaceAllLiteral(html, slot.oldUrl, escapeHtml(product.url));
    html = replaceAllLiteral(html, slot.oldImage, escapeHtml(product.image));
    html = replaceTextBlock(
      html,
      slot.titleId,
      '<p class="last-child"><strong>' + escapeHtml(product.title) + "</strong></p>"
    );
  });

  const copy = input.copy || {};
  html = replaceAllLiteral(html, OLD_SEE_MORE_URL, escapeHtml(input.collectionUrl));
  html = replaceTextBlock(
    html,
    "d1",
    '<p class="last-child">' + escapeHtml(copy.kicker) + "</p>"
  );
  html = replaceTextBlock(
    html,
    "d5",
    '<h1><span style="font-size: 23px">' + escapeHtml(copy.headline) +
      '</span></h1><p class="last-child">' + escapeHtml(copy.body) + "</p>"
  );

  const subject = cleanText(copy.subject || (copy.subjects && copy.subjects[0]) || "New collection");
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(subject) + "</title>");

  const preheader =
    '<span style="display:none!important;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' +
    escapeHtml(copy.preheader || "") +
    "</span>";
  html = html.replace(/<body([^>]*)>/i, "<body$1>" + preheader);

  const note = "<!-- Generated by Email Collection Builder | Suggested subject: " +
    subject.replace(/--/g, "—") + " -->\n";
  html = html.replace(/^(<!DOCTYPE[^>]*>\s*)/i, "$1" + note);
  return html;
}
