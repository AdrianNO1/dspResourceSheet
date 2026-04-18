import { useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent as ReactDragEvent, TextareaHTMLAttributes } from "react";

export function AutoGrowTextarea({ onChange, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [props.value]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    event.currentTarget.style.height = "0px";
    event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
    onChange?.(event);
  }

  return <textarea {...props} ref={textareaRef} onChange={handleChange} />;
}

type FileDropInputProps = {
  accept: string;
  description: string;
  disabled?: boolean;
  label: string;
  onSelect: (file: File | undefined) => void;
};

export function FileDropInput({ accept, description, disabled = false, label, onSelect }: FileDropInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    onSelect(file);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) {
      return;
    }

    handleFiles(event.dataTransfer.files);
  }

  return (
    <div
      className={`file-drop ${isDragging ? "file-drop-active" : ""} ${disabled ? "file-drop-disabled" : ""}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <button
        type="button"
        className="file-drop-surface"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <span className="file-drop-kicker">{label}</span>
        <strong className="file-drop-title">Drop a file here</strong>
        <p className="file-drop-description">{description}</p>
        <span className="file-drop-action">Browse files</span>
      </button>
    </div>
  );
}
