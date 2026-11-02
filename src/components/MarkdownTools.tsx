import { useEffect, useRef, useState, type RefObject } from "react";
import { Bold, Code2, FileCode2, Link2, Smile, Quote, Search, X } from "lucide-react";

// Familiar emoji with broad Windows 10, iOS and Android glyph coverage.
// The prior 2021 'holding back tears' glyph was missing on some Windows 10 systems.
type EmojiEntry = readonly [symbol: string, name: string];
const groups: { label: string; items: EmojiEntry[] }[] = [
  { label: "表情", items: [
    ["😀","开心 笑 smile"], ["😃","大笑 grin"], ["😄","高兴 笑"], ["😁","露齿笑"], ["😆","笑翻"],
    ["😅","苦笑 汗"], ["😂","笑哭"], ["🙂","微笑"], ["🙃","倒脸"], ["😉","眨眼"],
    ["😊","害羞"], ["😇","天使"], ["😍","喜欢 爱"], ["😘","飞吻"], ["😋","美味"],
    ["😎","墨镜 酷"], ["🤓","书呆子"], ["😐","平静"], ["😑","无语"], ["😮","惊讶"],
    ["😯","吃惊"], ["😢","伤心 哭"], ["😭","大哭"], ["😠","生气"], ["😡","愤怒"],
    ["😴","睡觉"], ["🤔","思考"], ["🤗","拥抱"], ["😷","口罩"], ["🙄","翻白眼"],
  ]},
  { label: "手势", items: [
    ["👍","赞 好"], ["👎","踩 不好"], ["👏","鼓掌"], ["🙌","欢呼"], ["🙏","谢谢 祈祷"],
    ["👌","好的"], ["✌️","胜利"], ["🤞","好运"], ["👊","碰拳"], ["✊","拳头"],
    ["👋","挥手 再见"], ["🖐️","手掌"], ["💪","加油"], ["👉","向右"], ["👈","向左"],
    ["👆","向上"], ["👇","向下"], ["☝️","注意"], ["🤝","握手"], ["🤘","摇滚"],
  ]},
  { label: "爱心", items: [
    ["❤️","红心 爱"], ["🧡","橙心"], ["💛","黄心"], ["💚","绿心"], ["💙","蓝心"],
    ["💜","紫心"], ["🖤","黑心"], ["💔","心碎"], ["❣️","感叹心"], ["💕","双心"],
    ["💞","旋转爱心"], ["💓","心跳"], ["💗","心动"], ["💖","闪亮爱心"], ["💘","一箭穿心"],
    ["💝","礼物爱心"], ["💟","爱心装饰"], ["💌","情书"],
  ]},
  { label: "庆祝", items: [
    ["🎉","庆祝 礼花"], ["🎊","彩纸"], ["🎈","气球"], ["🎁","礼物"], ["🎂","蛋糕"],
    ["🎆","烟火"], ["🎇","烟花"], ["✨","闪光"], ["🌟","闪亮星星"], ["⭐","星星"],
    ["💫","晕眩"], ["🎵","音乐"], ["🎶","音符"], ["🎤","话筒"], ["🎸","吉他"],
    ["🎮","游戏"], ["🏆","奖杯"], ["🥇","第一名"], ["🎯","靶心"], ["🎨","调色板"],
    ["📣","喇叭"], ["🔔","铃铛"],
  ]},
  { label: "科技", items: [
    ["💻","电脑 代码 code"], ["🖥️","显示器"], ["⌨️","键盘"], ["🖱️","鼠标"], ["📱","手机"],
    ["📲","短信"], ["📷","相机"], ["📹","摄像机"], ["💾","保存 磁盘"], ["💿","光盘"],
    ["📡","卫星"], ["🔋","电池"], ["🔌","插头"], ["🧠","大脑"], ["💡","想法 灵感"],
    ["🔍","搜索"], ["🔧","扳手"], ["🛠️","工具"], ["⚙️","设置 齿轮"], ["📊","图表"],
    ["📈","上涨"], ["📉","下跌"], ["📝","笔记"], ["📚","书籍"], ["🚀","火箭"],
  ]},
  { label: "自然", items: [
    ["🌸","樱花"], ["🌹","玫瑰"], ["🌻","向日葵"], ["🌷","郁金香"], ["🌱","发芽"],
    ["🌿","植物"], ["🍀","四叶草 好运"], ["🌲","松树"], ["🌳","大树"], ["🌈","彩虹"],
    ["☀️","太阳"], ["🌙","月亮"], ["☁️","云"], ["⛄","雪人"], ["❄️","雪花"],
    ["🔥","火 热门"], ["💧","水滴"], ["🌊","海浪"], ["⚡","闪电"], ["🌍","地球"],
    ["🌎","世界"], ["🌏","亚洲"],
  ]},
  { label: "食物", items: [
    ["🍎","苹果"], ["🍊","橘子"], ["🍋","柠檬"], ["🍌","香蕉"], ["🍉","西瓜"],
    ["🍇","葡萄"], ["🍓","草莓"], ["🍒","樱桃"], ["🍍","菠萝"], ["🍕","披萨"],
    ["🍔","汉堡"], ["🍟","薯条"], ["🍣","寿司"], ["🍜","面条"], ["🍙","饭团"],
    ["🍩","甜甜圈"], ["🍪","曲奇"], ["☕","咖啡"], ["🍵","茶"], ["🍺","啤酒"],
  ]},
  { label: "符号", items: [
    ["✅","完成 对"], ["❌","错误"], ["⚠️","警告"], ["❗","感叹"], ["❓","问号"],
    ["💯","满分"], ["✔️","勾选"], ["✖️","叉"], ["➕","加"], ["➖","减"],
    ["➡️","向右"], ["⬅️","向左"], ["⬆️","向上"], ["⬇️","向下"], ["🔒","锁"],
    ["🔓","解锁"], ["🔗","链接"], ["🏷️","标签"], ["📌","图钉"], ["📍","位置"],
  ]},
];
const all = groups.flatMap((group) => group.items);
const STORAGE_KEY = "waylan:emoji-recent";

type Props = {
  value: string;
  onChange: (value: string) => void;
  area: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  maxLength?: number;
};
/** Shared, locally-rendered Markdown and searchable emoji picker. No external emoji requests. */
export function MarkdownTools({ value, onChange, area, disabled, maxLength }: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [group, setGroup] = useState("表情");
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(parsed))
        setRecent(parsed.filter((x): x is string => typeof x === "string").slice(0, 20));
    } catch { /* Browsers may disable local storage. */ }
  }, []);
  useEffect(() => {
    if (!emojiOpen) return;
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setEmojiOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setEmojiOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [emojiOpen]);
  function insert(prefix: string, suffix = "", placeholder = "文字", block = false) {
    const textarea = area.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || placeholder;
    const lead = block && start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const tail = block && end < value.length && value[end] !== "\n" ? "\n" : "";
    const next = value.slice(0, start) + lead + prefix + selected + suffix + tail + value.slice(end);
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(
        start + lead.length + prefix.length,
        start + lead.length + prefix.length + selected.length,
      );
    });
  }
  function addEmoji(symbol: string) {
    insert(symbol, "", "");
    setRecent((prev) => {
      const next = [symbol, ...prev.filter((x) => x !== symbol)].slice(0, 20);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  const matching = search.trim()
    ? all.filter(([symbol, name]) => symbol.includes(search.trim()) || name.toLowerCase().includes(search.trim().toLowerCase()))
    : group === "最近"
      ? recent.flatMap((symbol) => all.filter((entry) => entry[0] === symbol))
      : groups.find((entry) => entry.label === group)?.items || [];
  return (
    <div className="markdown-tools" role="toolbar" aria-label="Markdown 格式工具">
      <button type="button" title="加粗" aria-label="加粗" disabled={disabled}
        onClick={() => insert("**", "**", "加粗文字")}><Bold size={16} /></button>
      <button type="button" title="行内代码" aria-label="行内代码" disabled={disabled}
        onClick={() => insert("`", "`", "代码")}><Code2 size={16} /></button>
      <button type="button" title="代码块" aria-label="代码块" disabled={disabled}
        onClick={() => insert("```\n", "\n```", "粘贴代码", true)}><FileCode2 size={16} /></button>
      <button type="button" title="引用" aria-label="引用" disabled={disabled}
        onClick={() => insert("> ", "", "引用内容", true)}><Quote size={16} /></button>
      <button type="button" title="链接" aria-label="链接" disabled={disabled}
        onClick={() => insert("[", "](https://)", "链接文字")}><Link2 size={16} /></button>
      <div className="markdown-emoji-wrap" ref={picker}>
        <button type="button" aria-label="选择表情" title="表情" disabled={disabled}
          aria-expanded={emojiOpen} onClick={() => setEmojiOpen((v) => !v)}>
          <Smile size={16} />
        </button>
        {emojiOpen && <div className="markdown-emoji-picker" role="group" aria-label="Emoji 表情选择器">
          <div className="emoji-picker-header">
            <strong>表情</strong>
            <button type="button" aria-label="关闭表情面板" onClick={() => setEmojiOpen(false)}><X size={16}/></button>
          </div>
          <div className="emoji-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" aria-label="搜索表情" placeholder="搜索表情…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="emoji-categories" role="group" aria-label="表情分类">
            {recent.length > 0 && <button type="button" className={group === "最近" && !search ? "selected" : ""} onClick={() => { setGroup("最近"); setSearch(""); }}>最近</button>}
            {groups.map((item) => (
              <button type="button" key={item.label} className={group === item.label && !search ? "selected" : ""}
                onClick={() => { setGroup(item.label); setSearch(""); }}>{item.label}</button>
            ))}
          </div>
          <div className="emoji-grid">
            {matching.length ? matching.map(([symbol, name]) => (
              <button type="button" key={symbol + name} title={name} aria-label={`插入表情：${name}`}
                onClick={() => addEmoji(symbol)}><span className="emoji-glyph">{symbol}</span></button>
            )) : <p className="emoji-empty">没有找到相关表情。</p>}
          </div>
        </div>}
      </div>
      <span className="markdown-tools-hint">Markdown</span>
    </div>
  );
}
