import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync("src/pages/Home.tsx", "utf8");
const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
const feed = readFileSync("src/components/Feed.tsx", "utf8");
const shell = readFileSync("src/styles/shell.css", "utf8");
const feedCss = readFileSync("src/styles/feed.css", "utf8");
const sideCss = readFileSync("src/styles/sidebar.css", "utf8");

describe("homepage navigation and category marks", () => {
  it("has one all-content CTA and keeps only topic shortcuts under the stream", () => {
    assert.equal((home.match(/浏览全部内容<ArrowRight/g) || []).length, 1);
    assert.doesNotMatch(home, /home-end-primary/);
    assert.match(home, /className="home-topic-shortcuts"/);
    assert.match(shell, /\.home-topic-shortcuts \{ display: none; \}/);
  });

  it("uses a different icon for each content type", () => {
    const icons = {
      article: "BookOpen",
      note: "NotebookPen",
      thought: "Lightbulb",
      journal: "Code2",
      project: "FolderKanban",
    };
    for (const [type, icon] of Object.entries(icons)) {
      assert.ok(feed.includes(`${type}: ${icon},`), `missing icon for ${type}`);
    }
    assert.match(feed, /<TypeIcon size=\{14\}/);
    assert.match(feedCss, /\.type-mark \{[\s\S]*?color: var\(--accent\);/);
  });

  it("distinguishes topic and project rows without sacrificing aligned hit areas", () => {
    for (const [topic, icon] of Object.entries({
      system: "MonitorCog",
      network: "Network",
      dev: "Code2",
      explore: "Compass",
      notes: "NotebookPen",
    })) {
      assert.ok(sidebar.includes(`${topic}: ${icon},`), `missing topic icon for ${topic}`);
    }
    assert.match(sidebar, /<TopicIcon size=\{15\}/);
    assert.match(home, /<SideTitle icon=\{<FolderKanban size=\{17\} \/>\}/);
    assert.match(home, /className="home-project-icon"/);
    assert.match(home, /<Folder size=\{15\} \/>/);
    assert.match(sideCss, /\.site-sidebar \.home-projects a \{[\s\S]*?padding-left: 0;/);
    assert.match(shell, /\.home-project-icon \{[\s\S]*?var\(--sidebar-start-slot\)/);
  });
});
