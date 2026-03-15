import { useEffect, useRef, useState } from "react";
import type { ResourceDefinition } from "../lib/types";
import { ResourceIcon } from "./ResourceIcon";

type ResourceSelectProps = {
  resources: ResourceDefinition[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function ResourceSelect({
  resources,
  value,
  onChange,
  disabled = false,
  placeholder = "Select resource",
}: ResourceSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = resources.find((resource) => resource.id === value) ?? null;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div ref={rootRef} className={`resource-select ${open ? "resource-select-open" : ""}`}>
      <button
        type="button"
        className="resource-select-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        {selected ? (
          <span className="resource-select-value">
            <ResourceIcon
              name={selected.name}
              iconUrl={selected.icon_url}
              colorStart={selected.color_start}
              colorEnd={selected.color_end}
              size="sm"
            />
            <span>{selected.name}</span>
          </span>
        ) : (
          <span className="resource-select-placeholder">{placeholder}</span>
        )}
        <span className="resource-select-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="resource-select-menu" role="listbox">
          {resources.map((resource) => (
            <button
              key={resource.id}
              type="button"
              className={`resource-select-option ${resource.id === value ? "resource-select-option-selected" : ""}`}
              onClick={() => {
                onChange(resource.id);
                setOpen(false);
              }}
            >
              <ResourceIcon
                name={resource.name}
                iconUrl={resource.icon_url}
                colorStart={resource.color_start}
                colorEnd={resource.color_end}
                size="sm"
              />
              <span>{resource.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
