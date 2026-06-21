"""EPUB parsing and chapter extraction, adapted from the sibling zipcast project."""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import ebooklib
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from ebooklib import epub

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

CONTENT_TAGS = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]
SKIP_TAGS = ["script", "style", "meta", "head", "link", "noscript", "nav", "header", "footer"]
MIN_CHAPTER_WORDS = 50
UNSAFE_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


@dataclass
class Chapter:
    index: int
    title: str
    text: str

    @property
    def word_count(self) -> int:
        return len(self.text.split())

    @property
    def filename_base(self) -> str:
        safe_title = UNSAFE_FILENAME_CHARS.sub("_", self.title)
        safe_title = safe_title.strip().replace(" ", "_")[:50] or "chapter"
        return f"{self.index:03d}_{safe_title}"


@dataclass
class Book:
    title: str
    author: str
    language: str
    chapters: list[Chapter]

    def to_metadata(self) -> dict:
        return {
            "title": self.title,
            "author": self.author,
            "language": self.language,
            "chapters": [
                {
                    "index": c.index,
                    "title": c.title,
                    "filename_base": c.filename_base,
                    "word_count": c.word_count,
                }
                for c in self.chapters
            ],
        }


def extract_text_from_html(html_content: bytes) -> str:
    soup = BeautifulSoup(html_content, "lxml")
    for tag in soup.find_all(SKIP_TAGS):
        tag.decompose()

    paragraphs = []
    for tag in soup.find_all(CONTENT_TAGS):
        if tag.find(CONTENT_TAGS):
            parts = []
            for child in tag.children:
                name = getattr(child, "name", None)
                if name is None or name not in CONTENT_TAGS:
                    parts.append(child.get_text())
            text = " ".join("".join(parts).split())
            if text:
                paragraphs.append(text)
            continue
        text = " ".join(tag.get_text().split())
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def extract_title_from_html(html_content: bytes) -> str | None:
    soup = BeautifulSoup(html_content, "lxml")
    title_tag = soup.find("title")
    if title_tag and title_tag.string:
        return title_tag.string.strip()
    for tag in ["h1", "h2", "h3"]:
        heading = soup.find(tag)
        if heading:
            text = heading.get_text(strip=True)
            if text:
                return text
    return None


def extract_cover(book: epub.EpubBook) -> bytes | None:
    for cid in ["cover", "cover-image", "coverimage"]:
        if item := book.get_item_with_id(cid):
            return cast(bytes, item.get_content())
    if cover_meta := book.get_metadata("OPF", "cover"):
        if item := book.get_item_with_id(str(cover_meta[0][0])):
            return cast(bytes, item.get_content())
    images = list(book.get_items_of_type(ebooklib.ITEM_IMAGE))
    for item in images:
        if "cover" in item.get_name().lower():
            return cast(bytes, item.get_content())
    return cast(bytes, images[0].get_content()) if images else None


def parse_epub(path: Path) -> tuple[Book, bytes | None]:
    eb = epub.read_epub(str(path), options={"ignore_ncx": True})

    def get_meta(key: str, default: str = "") -> str:
        meta = eb.get_metadata("DC", key)
        return str(meta[0][0]) if meta and meta[0] else default

    book = Book(
        title=get_meta("title", path.stem),
        author=get_meta("creator", "Unknown"),
        language=get_meta("language", "en"),
        chapters=[],
    )
    for item in eb.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        content = cast(bytes, item.get_content())
        text = extract_text_from_html(content)
        if len(text.split()) < MIN_CHAPTER_WORDS:
            continue
        idx = len(book.chapters) + 1
        title = extract_title_from_html(content) or f"Chapter {idx}"
        book.chapters.append(Chapter(index=idx, title=title, text=text))
    return book, extract_cover(eb)
