import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import Router from "next/router";

// Preserve react-search-box 2.3.0 interactions and styling; see licenses/react-search-box.txt.
export default function SearchBox({ author, posts }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const container = useRef(null);
  const search = useMemo(() => new Fuse(posts.map((post) => ({
    value: author ? post.name : `${post.name} - ${post.author}`,
    key: post.slug,
  })), {
    threshold: 0.05,
    location: 0,
    distance: 100,
    minMatchCharLength: 1,
    keys: ["value"],
  }), [author, posts]);
  // A field query preserves the previous empty and whitespace matching behavior.
  const matches = search.search({ value: query });
  const placeholder = `Prohledávej ${author ? "autora" : "zpěvníček"}`;

  useEffect(() => {
    const closeOutside = (event) => {
      if (container.current && !container.current.contains(event.target)) {
        setIsOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  const select = (record) => {
    setQuery(record.item.value);
    setIsOpen(false);
    Router.push(`/song/${record.item.key}/`);
  };

  return (
    <div ref={container}>
      <div className="song-search">
        <span className="song-search-input-container">
          <input
            className="song-search-input"
            type="text"
            name=""
            placeholder={placeholder}
            aria-label={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.code === "Enter" && matches.length === 1) {
                event.preventDefault();
                select(matches[0]);
              }
            }}
          />
        </span>
        {isOpen && (
          <div className="song-search-dropdown">
            <ul>
              {matches.map((record) => (
                <li className="react-search-box-dropdown-list-item" key={record.item.key}>
                  <button type="button" onClick={() => select(record)}>
                    {record.item.value}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
