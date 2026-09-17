import test from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_DEFINITIONS,
  extractProducts,
  generateCopy,
  renderEmail
} from "../netlify/functions/core.mjs";

test("extractProducts keeps collection order and returns nine unique products", () => {
  const cards = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return [
      '<article class="product-card">',
      '<a href="/design-' + number + '/unisex-standard-t-shirt?color=navy">',
      '<img data-src="/images/' + number + '.png" alt="Design ' + number + '">',
      "</a>",
      "</article>"
    ].join("");
  }).join("");

  const products = extractProducts(
    "<html><body>" + cards + "</body></html>",
    "https://example.com/collection/cat?sort=popular",
    9
  );

  assert.equal(products.length, 9);
  assert.equal(products[0].title, "Design 1");
  assert.equal(products[8].title, "Design 9");
  assert.equal(products[0].image, "https://example.com/images/1.png");
});

test("generateCopy creates cat-specific subjects and opening text", () => {
  const products = Array.from({ length: 9 }, (_, index) => ({
    title: "Funny Cat Shirt " + (index + 1),
    url: "https://example.com/p/" + index,
    image: "https://example.com/i/" + index + ".png"
  }));
  const copy = generateCopy("Cat Collection", products, "https://example.com/collection/cat");
  assert.equal(copy.subjects.length, 4);
  assert.match(copy.headline, /Cats/);
  assert.match(copy.body, /boss of the house/);
});

test("renderEmail replaces all nine products, copy, see-more URL, and strips scripts", () => {
  const slots = SLOT_DEFINITIONS.map((slot) => (
    '<a href="' + slot.oldUrl + '"><img src="' + slot.oldImage + '"></a>' +
    '<div class="mceText" id="' + slot.titleId + '"><p>Old title</p></div>'
  )).join("");

  const template = [
    "<!doctype html><html><head><title>*|MC:SUBJECT|*</title></head><body>",
    '<div id="d1"><p>Old kicker</p></div>',
    '<div id="d5"><h1>Old headline</h1><p>Old body</p></div>',
    slots,
    '<a href="https://judiedude.store/collection/cat?sort=newest&page=2">See more</a>',
    "<script>alert('remove me')</script>",
    "</body></html>"
  ].join("");

  const products = Array.from({ length: 9 }, (_, index) => ({
    title: "Product " + (index + 1),
    url: "https://shop.example/products/" + (index + 1) + "?ref=email&slot=" + index,
    image: "https://cdn.example/images/" + (index + 1) + ".png?width=1200&format=webp"
  }));

  const output = renderEmail(template, {
    collectionUrl: "https://shop.example/collection/new?sort=popular&page=1",
    products,
    copy: {
      subject: "Fresh Collection",
      preheader: "Nine new products.",
      kicker: "Fresh picks.",
      headline: "Made to Be Noticed",
      body: "A short collection introduction."
    }
  });

  assert.doesNotMatch(output, /alert\(/);
  assert.match(output, /<title>Fresh Collection<\/title>/);
  assert.match(output, /Product 9/);
  assert.match(output, /slot=0/);
  assert.match(output, /sort=popular&amp;page=1/);
  assert.match(output, /Made to Be Noticed/);
  assert.match(output, /Nine new products/);
});
