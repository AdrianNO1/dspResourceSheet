import { useEffect, useMemo, useRef, useState } from "react";
import { sortByRecentId } from "../lib/recentSort";

export type SearchableSelectOption = {
  value: string;
  label: string;
  searchText?: string;
};

type SearchableSelectProps = {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  recentValue?: string | null;
};

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

export function SearchableSelect({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = "Select option",
  searchPlaceholder = "Search options",
  emptyText = "No matches found.",
  recentValue = null,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  function closeMenu() {
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    searchInputRef.current?.focus();
  }, [open]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    const matchingOptions = !normalizedQuery
      ? options
      : options.filter((option) => {
          const haystack = normalizeSearchText(`${option.label} ${option.searchText ?? ""}`);
          return haystack.includes(normalizedQuery);
        });

    return sortByRecentId(
      matchingOptions,
      recentValue,
      (option) => option.value,
      (left, right) => left.label.localeCompare(right.label),
    );
  }, [options, query, recentValue]);

  return (
    <div ref={rootRef} className={`searchable-select ${open ? "searchable-select-open" : ""}`}>
      <button
        type="button"
        className="searchable-select-trigger"
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }

          openMenu();
        }}
        disabled={disabled}
      >
        <span className={selected ? "searchable-select-value" : "searchable-select-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="searchable-select-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="searchable-select-menu">
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeMenu();
              }
            }}
            className="searchable-select-search"
            placeholder={searchPlaceholder}
          />

          <div className="searchable-select-options" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`searchable-select-option ${option.value === value ? "searchable-select-option-selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    closeMenu();
                  }}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <p className="searchable-select-empty">{emptyText}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
