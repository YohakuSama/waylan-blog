import { useState, type RefObject } from "react";
import { Bold, Code2, FileCode2, Link2, Smile, Quote } from "lucide-react";

const emojis = ["😀", "😄", "😊", "😂", "🥹", "❤️", "👍", "👏", "🎉", "🔥", "🤔", "💡", "🙏", "🚀", "✨", "💻"];

type Props = {
  value: string;
  onChange: (value: string) => void;
  area: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
};
/** Small reusable Markdown insert bar for comments and the article editor. */
export function MarkdownTools({ value, onChange, area, disabled }: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  function insert(prefix: string, suffix = "", placeholder = "文字", block = false) {
    const textarea = area.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || placeholder;
    const lead = block && start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const tail = block && end < value.length && value[end] !== "\n" ? "\n" : "";
    const before = value.slice(0, start);
    const next = before + lead + prefix + selected + suffix + tail + value.slice(end);
    onChange(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        start + lead.length + prefix.length,
        start + lead.length + prefix.length + selected.length,
      );
    });
  }
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
      <div className="markdown-emoji-wrap">
        <button type="button" aria-label="选择表情" title="表情" disabled={disabled}
          aria-expanded={emojiOpen} onClick={() => setEmojiOpen((v) => !v)}>
          <Smile size={16} />
        </button>
        {emojiOpen && <div className="markdown-emoji-picker" role="group" aria-label="常用表情">
          {emojis.map((symbol) => (
            <button type="button" key={symbol} title={symbol} aria-label={`插入 ${symbol}`}
              onClick={() => insert(symbol, "", "")}>{symbol}</button>
          ))}
        </div>}
      </div>
      <span className="markdown-tools-hint">Markdown</span>
    </div>
  );
}
