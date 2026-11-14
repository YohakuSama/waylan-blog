import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const feed = readFileSync("src/components/Feed.tsx", "utf8");
const feedCss = readFileSync("src/styles/feed.css", "utf8");
const responsive = readFileSync("src/styles/responsive.css", "utf8");
const shell = readFileSync("src/styles/shell.css", "utf8");
const aboutCss = readFileSync("src/styles/site.css", "utf8");

describe("shared feed actions and About contact layout", () => {
  it("keeps one bookmark/open pair in each post variant and in compact density", () => {
    assert.equal((feed.match(/<FeedActions post=\{post\} href=\{href\} \/>/g) || []).length, 2);
    assert.match(feed, /<BookmarkButton post=\{post\} className="card-bookmark" \/>/);
    assert.match(feed, /<Link className="feed-arrow" href=\{href\}/);
    assert.doesNotMatch(feedCss, /\.density-compact \.feed-arrow\s*\{\s*display:\s*none/);
    assert.match(feedCss, /\.density-compact \.feed-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 92px;/s);
    assert.match(feedCss, /\.density-compact \.feed-actions\s*\{\s*gap:\s*4px;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.feed-tail\s*\{\s*height: 24px;\s*min-height: 24px;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.feed-actions\s*\{\s*margin-block: -16px -4px;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.project-status \{[^}]*display: none;/);
  });

  it("places project technologies next to shared actions, not in a separate empty facts row", () => {
    assert.match(feedCss, /\.feed-item\.is-project \.project-facts:empty\s*\{\s*display: none;/);
    const tail = feed.slice(feed.lastIndexOf('<div className="feed-tail">'));
    assert.match(tail, /className="feed-tail-tags"[\s\S]*?<ul className="stack-list" aria-label="技术栈">/);
    assert.match(tail, /<FeedActions post=\{post\} href=\{href\} \/>/);
    assert.match(shell, /\.home-list \.stack-list\s*\{\s*display: none;/);
  });

  it("clusters contacts on desktop and gives narrow screens a single readable column", () => {
    assert.match(aboutCss, /\.about-contact \.social-links\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/s);
    const contacts = aboutCss.slice(aboutCss.indexOf(".about-contact .social-links {"), aboutCss.indexOf(".about-contact .social-links li {"));
    assert.doesNotMatch(contacts, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(aboutCss, /@media \(max-width: 600px\)\s*\{\s*\.about-contact \.social-links\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(aboutCss, /\.about-contact \.social-links a\s*\{[^}]*min-height: 44px;/s);
  });
});
