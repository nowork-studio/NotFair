import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import test from "node:test";

const readme = await readFile(
  fileURLToPath(new URL("../README.md", import.meta.url)),
  "utf8",
);

test("README requires sanitized, scoped NotFair article rendering", () => {
  assert.match(readme, /sanitizeNotFairArticleHtml/);
  assert.match(readme, /notfair-article\.module\.css/);
  assert.match(readme, /:global\(\.nf-toc\)/);
  assert.match(readme, /:global\(\.nf-tablewrap\)/);
  assert.match(readme, /list-style: disc/);
  assert.match(readme, /from "\.\.\/notfair-article\.module\.css"/);
  assert.doesNotMatch(readme, /dangerouslySetInnerHTML=\{\{ __html: post\.content_html \}\}/);
});
