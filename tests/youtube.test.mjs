import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYouTubeId, youtubeThumbnail, youtubeWatchUrl } from "../lib/youtube.ts";

const ID = "dQw4w9WgXcQ";

test("parseYouTubeId понимает основные ссылки YouTube", () => {
  assert.equal(parseYouTubeId(`https://youtu.be/${ID}`), ID);
  assert.equal(parseYouTubeId(`https://youtu.be/${ID}?t=42`), ID);
  assert.equal(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&list=PL123`), ID);
  assert.equal(parseYouTubeId(`https://music.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseYouTubeId(`https://youtube.com/shorts/${ID}`), ID);
  assert.equal(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
  assert.equal(parseYouTubeId(ID), ID);
});

test("parseYouTubeId отбраковывает мусор и чужие ссылки", () => {
  assert.equal(parseYouTubeId(""), null);
  assert.equal(parseYouTubeId("не ссылка"), null);
  assert.equal(parseYouTubeId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYouTubeId("https://youtu.be/too-short"), null);
  assert.equal(parseYouTubeId("https://youtube.com/watch?v=bad"), null);
});

test("каноническая ссылка и превью", () => {
  assert.equal(youtubeWatchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(youtubeThumbnail(ID), `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
});
