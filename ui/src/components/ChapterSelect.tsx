import { useEffect, useRef, useState } from "react";
import type { Chapter } from "../types";

export function ChapterSelect({ chapters, value, onChange, label, disabled }: { chapters: Chapter[]; value: number; onChange: (index: number) => void; label: string; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = chapters.find((chapter) => chapter.index === value);
  const placeholder = selected ? `${selected.index}. ${selected.title}` : "Search chapters...";
  const filtered = chapters.filter((chapter) => `${chapter.index}. ${chapter.title}`.toLowerCase().includes(query.toLowerCase()));

  function select(chapter: Chapter) {
    onChange(chapter.index);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-medium text-ink/60">{label}</label>
      <input
        className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-ink placeholder:opacity-100 disabled:opacity-50"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && !disabled && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-white text-sm shadow-md">
          {filtered.length ? filtered.map((chapter) => (
            <li
              key={chapter.index}
              onMouseDown={() => select(chapter)}
              className={`cursor-pointer px-3 py-2 hover:bg-cream ${chapter.index === value ? "bg-cream font-medium" : ""}`}
            >
              {chapter.index}. {chapter.title}
            </li>
          )) : (
            <li className="px-3 py-2 text-ink/50">No chapters found</li>
          )}
        </ul>
      )}
    </div>
  );
}

