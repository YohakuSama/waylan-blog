import { ArrowUpRight } from "lucide-react";
import { newestFirst, posts } from "../lib/data";
import { Link } from "../lib/router";
import { FeedList } from "../components/Feed";
import { Sidebar } from "../components/Sidebar";

export function Projects() {
  const items = posts.filter((p) => p.type === "project").sort(newestFirst);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / PROJECTS</p>
        <h1>项目</h1>
        <p>
          项目与实验记录，包括当前状态、技术栈和相关链接。
        </p>
      </header>
      <div className="content-grid projects-layout">
        <section className="feed-column" aria-label="项目列表">
          <div className="feed-result-line">
            <span>{items.length} 个项目</span>
            <Link href="/feed">
              全部内容
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <FeedList
            items={items}
            resetKey="projects"
            empty={
              <div className="empty-state">
                <h2>暂无项目</h2>
                <p>第一个项目整理好之后，会出现在这里。</p>
              </div>
            }
          />
        </section>
        <Sidebar current="/projects" mode="projects" />
      </div>
    </>
  );
}
