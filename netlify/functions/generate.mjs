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

async function fetchHtml(inputUrl) {
  let url = parsePublicUrl(inputUrl);

  for (let redirect = 0; redirect < 5; redirect += 1) {
    await assertSafeFetchTarget(url);

    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(18000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; EmailCollectionBuilder/1.0)",
        accept: "text/html,application/xhtml+xml"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Website chuyển hướng nhưng không cung cấp URL mới.");
      url = new URL(location, url);
      continue;
    }

    if (!response.ok) {
      throw new Error("Website trả về HTTP " + response.status + ".");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/html|xhtml/i.test(contentType)) {
      throw new Error("Đường dẫn không trả về trang HTML.");
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      throw new Error("Trang collection lớn hơn giới hạn 5 MB.");
    }
    return { html, finalUrl: url.href };
  }

  throw new Error("Website chuyển hướng quá nhiều lần.");
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
