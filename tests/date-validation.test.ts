import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, toDate } from "../shared/content-rules";
import { parseAnnouncements } from "../shared/announcements";
import { validISODate } from "../shared/date";

const notice = {
  id: "notice-date", title: "维护", body: "维护公告", priority: "normal",
  published: true, link: "", revision: 1,
};

describe("Strict ISO calendar dates", () => {
  it("accepts real dates including leap days", () => {
    for (const date of ["2024-02-29", "2026-11-15", "2000-02-29"]) {
      assert.equal(validISODate(date), true);
      assert.equal(toDate(date, "发布日期"), date);
      assert.equal(parseAnnouncements([{ ...notice, updated: date }])[0].updated, date);
    }
  });
  it("keeps raw YAML date values for validation before JavaScript normalizes them", () => {
    const valid = parseFrontmatter("---\ndate: 2024-02-29\n---\nText");
    assert.equal(valid.data.date, "2024-02-29");
    const invalid = parseFrontmatter("---\ndate: 2026-02-30\n---\nText");
    assert.equal(invalid.data.date, "2026-02-30");
    assert.throws(() => toDate(invalid.data.date, "发布日期"), /YYYY-MM-DD/);
  });

  it("rejects overflow dates in both posts and announcements", () => {
    for (const date of ["2026-02-30", "2025-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-1", "garbage"]) {
      assert.equal(validISODate(date), false, date);
      assert.throws(() => toDate(date, "发布日期"), /YYYY-MM-DD/, date);
      assert.throws(() => parseAnnouncements([{ ...notice, updated: date }]), /日期/, date);
    }
  });
});
