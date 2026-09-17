import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import net from "node:net";
import {
  extractCollectionTitle,
  extractProductMeta,
  extractProducts,
  generateCopy,
  renderEmail
} from "./core.mjs";

const TEMPLATE_PATH = fileURLToPath(new URL("./email-template.html", import.meta.url));
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const DIRECT_TIMEOUT_MS = 8000;
const WARM_TIMEOUT_MS = 4000;
const RETRY_TIMEOUT_MS = 8000;
const READER_TIMEOUT_MS = 20000;
const RETRYABLE_BLOCK_STATUSES = new Set([401, 403, 429, 503]);
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/152.0.0.0 Safari/537.36";
let templateCache = "";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

function parsePublicUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("URL không hợp lệ.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL phải bắt đầu bằng http:// hoặc https://.");
  }
  if (url.username || url.password) {
    throw new Error("URL không được chứa thông tin đăng nhập.");
  }
  return url;
}

function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];

  if (net.isIPv4(value)) {
    const parts = value.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (net.isIPv6(value)) {
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (value.startsWith("::ffff:")) {
      return isPrivateAddress(value.slice(7));
    }
  }

  return false;
}

async function assertSafeFetchTarget(url) {
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Không thể truy cập địa chỉ nội bộ.");
  }

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Không thể truy cập địa chỉ IP riêng.");
    return;
  }

  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Tên miền trỏ tới địa chỉ không được phép.");
  }
}

function browserHeaders(url, { referer = "", cookie = "" } = {}) {
  let fetchSite = "none";
  if (referer) {
    try {
      fetchSite = new URL(referer).origin === url.origin ? "same-origin" : "cross-site";
    } catch {
      fetchSite = "cross-site";
    }
  }

  return {
    "user-agent": CHROME_USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    priority: "u=0, i",
    "sec-ch-ua": "\"Chromium\";v=\"152\", \"Google Chrome\";v=\"152\", \"Not_A Brand\";v=\"99\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": fetchSite,
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    ...(referer ? { referer } : {}),
    ...(cookie ? { cookie } : {})
  };
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  return splitSetCookieHeader(response.headers.get("set-cookie"));
}

function mergeCookieHeader(existing, setCookieValues) {
  const pairs = new Map();

  for (const pair of String(existing || "").split(/;\s*/)) {
    const separator = pair.indexOf("=");
    if (separator > 0) pairs.set(pair.slice(0, separator), pair);
  }

  for (const value of setCookieValues) {
    const pair = String(value || "").split(";")[0].trim();
    const separator = pair.indexOf("=");
    if (separator > 0) pairs.set(pair.slice(0, separator), pair);
  }

  return [...pairs.values()].join("; ");
}

function rememberCookies(response, url, cookieJar) {
  const cookies = responseCookies(response);
  if (!cookies.length) return;
  cookieJar.set(url.origin, mergeCookieHeader(cookieJar.get(url.origin), cookies));
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be closed.
  }
}

async function fetchWithBrowser(inputUrl, {
  cookieJar = new Map(),
  referer = "",
  timeoutMs = DIRECT_TIMEOUT_MS
} = {}) {
  let url = parsePublicUrl(inputUrl);
  let currentReferer = referer;

  for (let redirect = 0; redirect < 5; redirect += 1) {
    await assertSafeFetchTarget(url);

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: browserHeaders(url, {
        referer: currentReferer,
        cookie: cookieJar.get(url.origin) || ""
      })
    });

    rememberCookies(response, url, cookieJar);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Website chuyển hướng nhưng không cung cấp URL mới.");
      const previousUrl = url;
      url = new URL(location, previousUrl);
      currentReferer = previousUrl.href;
      await discardBody(response);
      continue;
    }

    return { response, finalUrl: url.href, cookieJar };
  }

  throw new Error("Website chuyển hướng quá nhiều lần.");
}

async function warmBrowserSession(inputUrl, cookieJar) {
  const target = parsePublicUrl(inputUrl);
  const homepage = new URL("/", target);
  try {
    const result = await fetchWithBrowser(homepage.href, {
      cookieJar,
      referer: target.origin + "/",
      timeoutMs: WARM_TIMEOUT_MS
    });
    await discardBody(result.response);
  } catch {
    // Warming is best effort. The rendered-browser fallback remains available.
  }
}

async function readHtmlResponse(response, finalUrl, { allowPlainText = false } = {}) {
  if (!response.ok) {
    throw new Error("Website trả về HTTP " + response.status + ".");
  }

  const contentType = response.headers.get("content-type") || "";
  if (!/html|xhtml/i.test(contentType) && !(allowPlainText && /text\/plain/i.test(contentType))) {
    throw new Error("Đường dẫn không trả về trang HTML.");
  }

  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new Error("Trang collection lớn hơn giới hạn 5 MB.");
  }
  if (!/<(?:html|body|main|article|a|script)\b/i.test(html)) {
    throw new Error("Website không trả về nội dung HTML có thể đọc.");
  }

  return { html, finalUrl };
}

async function fetchViaRenderedBrowser(inputUrl, blockedStatus) {
  const target = parsePublicUrl(inputUrl);
  await assertSafeFetchTarget(target);

  const readerUrl = "https://r.jina.ai/" + target.href;
  let response;
  try {
    response = await fetch(readerUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(READER_TIMEOUT_MS),
      headers: {
        "user-agent": "EmailCollectionBuilder/1.1",
        accept: "text/plain",
        "x-engine": "browser",
        "x-respond-with": "html",
        "x-respond-timing": "resource-idle",
        "x-timeout": "15",
        "x-cache-tolerance": "300",
        "x-base": "final"
      }
    });
  } catch {
    throw new Error(
      "Website chặn truy cập tự động (HTTP " + blockedStatus +
      ") và chế độ trình duyệt dự phòng cũng không kết nối được."
    );
  }

  if (!response.ok) {
    await discardBody(response);
    throw new Error(
      "Website chặn truy cập tự động (HTTP " + blockedStatus +
      "); chế độ trình duyệt dự phòng trả về HTTP " + response.status + "."
    );
  }

  return readHtmlResponse(response, target.href, { allowPlainText: true });
}

async function fetchHtml(inputUrl) {
  const target = parsePublicUrl(inputUrl);
  const cookieJar = new Map();
  const first = await fetchWithBrowser(target.href, {
    cookieJar,
    timeoutMs: DIRECT_TIMEOUT_MS
  });

  if (first.response.ok) {
    return readHtmlResponse(first.response, first.finalUrl);
  }

  if (!RETRYABLE_BLOCK_STATUSES.has(first.response.status)) {
    const status = first.response.status;
    await discardBody(first.response);
    throw new Error("Website trả về HTTP " + status + ".");
  }

  const firstStatus = first.response.status;
  await discardBody(first.response);
  await warmBrowserSession(first.finalUrl, cookieJar);

  const retry = await fetchWithBrowser(first.finalUrl, {
    cookieJar,
    referer: new URL(first.finalUrl).origin + "/",
    timeoutMs: RETRY_TIMEOUT_MS
  });

  if (retry.response.ok) {
    return readHtmlResponse(retry.response, retry.finalUrl);
  }

  const retryStatus = retry.response.status;
  await discardBody(retry.response);

  if (!RETRYABLE_BLOCK_STATUSES.has(retryStatus)) {
    throw new Error("Website trả về HTTP " + retryStatus + ".");
  }

  return fetchViaRenderedBrowser(retry.finalUrl, retryStatus || firstStatus);
}

async function getTemplate() {
  if (!templateCache) templateCache = await readFile(TEMPLATE_PATH, "utf8");
  return templateCache;
}

function validateRenderProducts(products) {
  if (!Array.isArray(products) || products.length !== 9) {
    throw new Error("Cần đúng 9 sản phẩm để xuất email.");
  }

  return products.map((product, index) => {
    const url = parsePublicUrl(product.url).href;
    const image = parsePublicUrl(product.image).href;
    const title = String(product.title || "").trim();
    if (!title) throw new Error("Sản phẩm " + (index + 1) + " chưa có title.");
    return { url, image, title: title.slice(0, 180) };
  });
}

async function enrichMissingProducts(products) {
  return Promise.all(
    products.map(async (product) => {
      if (product.image && product.title) return product;
      try {
        const { html, finalUrl } = await fetchHtml(product.url);
        const meta = extractProductMeta(html, finalUrl);
        return {
          url: product.url,
          image: product.image || meta.image,
          title: product.title || meta.title
        };
      } catch {
        return product;
      }
    })
  );
}

async function handleScrape(body) {
  const input = parsePublicUrl(body.url);
  const { html: collectionHtml, finalUrl } = await fetchHtml(input.href);
  let products = extractProducts(collectionHtml, finalUrl, 9);
  products = await enrichMissingProducts(products);

  const complete = products.filter((product) => product.url && product.image && product.title);
  if (complete.length < 9) {
    throw new Error(
      "Chỉ tìm thấy " + complete.length +
      " sản phẩm đầy đủ. Website có thể đang render sản phẩm bằng JavaScript hoặc đã đổi cấu trúc HTML."
    );
  }

  const collectionTitle = extractCollectionTitle(collectionHtml, finalUrl);
  const copy = generateCopy(collectionTitle, complete, finalUrl);
  const template = await getTemplate();
  const output = renderEmail(template, {
    collectionUrl: finalUrl,
    products: complete,
    copy
  });

  return {
    collectionUrl: finalUrl,
    collectionTitle,
    products: complete,
    copy,
    html: output
  };
}

async function handleRender(body) {
  const collectionUrl = parsePublicUrl(body.url).href;
  const products = validateRenderProducts(body.products);
  const copy = {
    subject: String(body.copy?.subject || "").slice(0, 180),
    preheader: String(body.copy?.preheader || "").slice(0, 300),
    kicker: String(body.copy?.kicker || "").slice(0, 300),
    headline: String(body.copy?.headline || "").slice(0, 180),
    body: String(body.copy?.body || "").slice(0, 800)
  };

  const template = await getTemplate();
  return {
    collectionUrl,
    products,
    copy,
    html: renderEmail(template, { collectionUrl, products, copy })
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Chỉ hỗ trợ phương thức POST." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Dữ liệu JSON không hợp lệ." });
  }

  try {
    const result = body.action === "render"
      ? await handleRender(body)
      : await handleScrape(body);
    return json(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tạo email.";
    const statusCode = /không hợp lệ|phải bắt đầu|Cần đúng|chưa có title/i.test(message) ? 400 : 422;
    return json(statusCode, { error: message });
  }
};
