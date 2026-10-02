import React, { forwardRef, useEffect, useState } from 'react';

interface Props {
  /** Applied query ('' when off). */
  value: string;
  /** Matches in the current view; undefined while loading or not searching. */
  matches?: number;
  onSearch(query: string): void;
}

/**
 * Search box for the current view. Searching runs on Enter (each search scans
 * the whole view, including content), Esc restores the applied query and leaves
 * the box, and ✕ clears the search.
 */
export const SearchBox = forwardRef<HTMLInputElement, Props>(function SearchBox({ value, matches, onSearch }, ref) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <form
      className={['search', value ? 'search--active' : ''].join(' ')}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(draft);
        // Hand the keyboard back to list navigation (and close the mobile keyboard).
        (e.currentTarget.elements.namedItem('q') as HTMLInputElement | null)?.blur();
      }}
    >
      <svg className="search__icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z"
        />
      </svg>
      <input
        ref={ref}
        name="q"
        type="search"
        className="search__input"
        value={draft}
        placeholder="Search this view"
        aria-label="Search titles and content in this view"
        title="Search titles and content in this view (/)"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          setDraft(value);
          e.currentTarget.blur();
        }}
      />
      {!draft && !value && <kbd className="search__hint">/</kbd>}
      {value && matches !== undefined && (
        <span className="search__count" title={`${matches} match${matches === 1 ? '' : 'es'} in this view`}>
          {matches}
          <span className="search__count-label"> match{matches === 1 ? '' : 'es'}</span>
        </span>
      )}
      {(draft || value) && (
        <button
          type="button"
          className="search__clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            setDraft('');
            onSearch('');
          }}
        >
          ✕
        </button>
      )}
    </form>
  );
});
