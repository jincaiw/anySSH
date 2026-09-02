import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { useTranslation } from "../../i18n";

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "data-testid"?: string;
  /** When true, each dropdown option renders in its own `value` as a CSS
   *  font-family — a live preview for font pickers (like a text editor's font
   *  list). Only the list items preview; the trigger keeps the UI font. Set
   *  this only when every option's `value` is a valid font-family stack. */
  previewOptionFont?: boolean;
  /** Editable mode: the trigger becomes a text input, options filter as you
   *  type, and a custom value not present in `options` can be committed with
   *  Enter or on blur. */
  editable?: boolean;
  /** Editable mode only: predicate a typed value must pass before it is
   *  committed (Enter / blur). Invalid input reverts to the current value.
   *  Defaults to "non-empty after trim". */
  editableValidate?: (value: string) => boolean;
}

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "data-testid": testid,
  previewOptionFont,
  editable,
  editableValidate,
}: CustomSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // Editable mode: what the text input currently shows while editing.
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Whether the editable input currently has focus (guards the prop sync). */
  const editingRef = useRef(false);

  const validate = editableValidate ?? ((v: string) => v.trim().length > 0);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? (placeholder ?? t("shared.select.placeholder"));

  // Editable: keep the input in sync with the (possibly parent-normalised)
  // committed value whenever the user isn't mid-edit.
  useEffect(() => {
    if (!editingRef.current) setInputValue(value);
  }, [value]);

  // In editable mode a query filters the option list; otherwise all options show.
  const query = inputValue.trim().toLowerCase();
  const visibleOptions = editable && query.length > 0
    ? options.filter(
        (o) => o.label.toLowerCase().includes(query) || o.value.toLowerCase().includes(query),
      )
    : options;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightIndex] as HTMLElement;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, highlightIndex]);

  const computePos = () => {
    const anchor = editable ? inputRef.current : triggerRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  };

  /** Editable mode: commit the typed input (if it passes validation) and close. */
  const commitInput = () => {
    const trimmed = inputValue.trim();
    if (trimmed.length > 0 && validate(trimmed)) {
      if (trimmed !== value) onChange(trimmed);
      setInputValue(trimmed);
    } else {
      // Invalid input reverts to the committed value.
      setInputValue(value);
    }
    setOpen(false);
  };

  const openDropdown = () => {
    computePos();
    setOpen(true);
    const visible = editable && inputValue.trim().length > 0
      ? visibleOptions
      : options;
    setHighlightIndex(visible.findIndex((o) => o.value === value));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    // Editable input has its own handler below.
    if (editable) return;

    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      openDropdown();
      return;
    }

    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < options.length) {
        onChange(options[highlightIndex].value);
        setOpen(false);
      }
    }
  };

  /** Key handling while focus is in the editable text input. */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { openDropdown(); return; }
      setHighlightIndex((prev) => Math.min(prev + 1, visibleOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return;
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && highlightIndex >= 0 && highlightIndex < visibleOptions.length) {
        const option = visibleOptions[highlightIndex];
        onChange(option.value);
        setInputValue(option.value);
        setOpen(false);
      } else {
        commitInput();
      }
    } else if (e.key === "Escape") {
      // Revert to the committed value and close without committing.
      e.stopPropagation();
      setInputValue(value);
      setOpen(false);
    }
  };

  const triggerClasses = [
    "w-full flex items-center justify-between gap-2",
    "rounded-lg bg-bg-base border border-border px-3 py-2",
    "text-[length:var(--text-sm)] text-left",
    "outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
    "focus:border-border-focus focus:ring-2 focus:ring-ring",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    open ? "border-border-focus ring-2 ring-ring" : "",
  ].join(" ");

  const listbox = open && dropdownPos && createPortal(
    <div
      ref={listRef}
      role="listbox"
      aria-label={ariaLabel}
      style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
      className={[
        "fixed z-[100]",
        "max-h-[200px] overflow-y-auto",
        "bg-bg-overlay border border-border rounded-lg",
        "shadow-[var(--shadow-lg)]",
        "py-1",
        "animate-[fadeIn_80ms_var(--ease-expo-out)_both]",
      ].join(" ")}
    >
      {visibleOptions.length === 0 && (
        <div className="px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted">
          No matching options
        </div>
      )}
      {visibleOptions.map((option, index) => {
        const isSelected = option.value === value;
        const isHighlighted = index === highlightIndex;

        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-testid={testid ? `${testid}-option-${option.value}` : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(option.value);
              if (editable) setInputValue(option.value);
              setOpen(false);
            }}
            onMouseEnter={() => setHighlightIndex(index)}
            className={[
              "w-full flex items-center gap-2 px-3 py-1.5 text-left",
              "text-[length:var(--text-sm)] transition-colors duration-[var(--duration-fast)]",
              isHighlighted ? "bg-bg-subtle" : "",
              isSelected ? "text-accent font-medium" : "text-text-primary",
            ].join(" ")}
          >
            <span className="w-4 shrink-0">
              {isSelected && <Check size={14} strokeWidth={2.5} className="text-accent" />}
            </span>
            <span
              className="truncate"
              style={previewOptionFont ? { fontFamily: option.value } : undefined}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );

  if (editable) {
    return (
      <div ref={containerRef} className={`relative ${className ?? ""}`}>
        <div className={triggerClasses}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            data-testid={testid}
            data-value={value}
            disabled={disabled}
            value={inputValue}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onFocus={() => {
              editingRef.current = true;
              if (!disabled) openDropdown();
            }}
            onBlur={() => {
              editingRef.current = false;
              commitInput();
            }}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (!open) openDropdown();
              else setHighlightIndex(-1);
            }}
            onKeyDown={handleInputKeyDown}
            className="flex-1 min-w-0 bg-transparent outline-none text-text-primary placeholder:text-text-muted"
          />
          <button
            ref={triggerRef}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                if (!open) openDropdown();
                else setOpen(false);
              }
            }}
            className="shrink-0 text-text-muted focus:outline-none"
          >
            <ChevronDown
              size={15}
              strokeWidth={2}
              className={[
                "transition-transform duration-[var(--duration-fast)]",
                open ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
        </div>
        {listbox}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        data-testid={testid}
        data-value={value}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            if (!open) openDropdown();
            else setOpen(false);
          }
        }}
        onKeyDown={handleKeyDown}
        className={triggerClasses}
      >
        <span className={selectedOption ? "text-text-primary truncate" : "text-text-muted truncate"}>
          {displayLabel}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          className={[
            "text-text-muted shrink-0 transition-transform duration-[var(--duration-fast)]",
            open ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden="true"
        />
      </button>
      {listbox}
    </div>
  );
}
