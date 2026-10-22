import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import renderSongContent from "../lib/song-content.mjs";

test("keeps chords, strong labels, line breaks, and Czech text", () => {
  assert.equal(
    renderSongContent("<strong>REF:</strong>\n[Ami]Český text [G]dál"),
    '<strong>REF:</strong>\n<em class="chord">Ami</em>Český text <em class="chord">G</em>dál'
  );
});

test("treats all other markup and encoded markup as text", () => {
  const payloads = [
    '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)"><a href="javascript:alert(1)">link</a></svg>',
    '<math><mtext><img src=x onerror="alert(1)"></mtext></math>',
    '<strong onclick="alert(1)">label</strong>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<style>body{display:none}</style><!-- comment -->',
    '[<img src=x onerror="alert(1)">]',
    '<strong><img src=x onerror="alert(1)"></strong>',
    '<<strong>img src=x onerror="alert(1)">',
  ];
  for (const payload of payloads) {
    const html = renderSongContent(payload);
    assert.doesNotMatch(html.replace(/<\/?strong>|<em class="chord">|<\/em>/g, ""), /[<>]/);
    assert.match(html, /&lt;/);
  }
  assert.equal(renderSongContent("&lt;img src=x&gt; &#60;svg&#62;"),
    "&amp;lt;img src=x&amp;gt; &amp;#60;svg&amp;#62;");
});

test("preserves the rendered markup of every published song", () => {
  const directory = new URL("../_songs/", import.meta.url);
  for (const file of readdirSync(directory)) {
    const { text } = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    const previousMarkup = text.split("[").join('<em class="chord">').split("]").join("</em>");
    assert.equal(renderSongContent(text), previousMarkup, file);
  }
});
