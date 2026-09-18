import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { SlashCommandItem } from "./slash-commands";

// Standard @tiptap/suggestion React renderer contract: the component exposes
// `onKeyDown(props)` through its ref. We own selection state locally —
// ArrowUp/Down move it, Enter runs the command via suggestion's `command`.

interface SlashMenuProps extends SuggestionProps<SlashCommandItem> {}

const SlashMenu = forwardRef<{ onKeyDown: (props: SuggestionKeyDownProps) => boolean }, SlashMenuProps>(
  (props, ref) => {
    const { items, command } = props;
    const [selected, setSelected] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s - 1 + items.length) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          if (items[selected]) command(items[selected]);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-menu" ref={listRef}>
          <button disabled style={{ opacity: 0.5, cursor: "default" }}>
            没有匹配的命令 <span className="hint">esc 关闭</span>
          </button>
        </div>
      );
    }

    return (
      <div className="slash-menu" ref={listRef}>
        {items.map((item, i) => (
          <button
            key={item.title}
            className={i === selected ? "is-selected" : ""}
            onMouseEnter={() => setSelected(i)}
            onClick={() => command(item)}
          >
            <span>{item.title}</span>
            <span className="hint">{item.hint}</span>
          </button>
        ))}
      </div>
    );
  },
);

SlashMenu.displayName = "SlashMenu";
export default SlashMenu;
