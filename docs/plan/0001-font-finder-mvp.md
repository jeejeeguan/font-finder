# Font Finder MVP Plan

## Goal

Build a Raycast extension that makes it fast to:

1. Search local macOS fonts (Family → Styles).
2. Preview fonts inside Raycast (Quick Look thumbnail + Quick Look toggle).
3. Copy font names (primary: Family; secondary: Display Name, PostScript, CSS snippet).

## Non-Goals (MVP)

- Custom rendering preview text.
- Preferences for extra font directories.
- Advanced fuzzy ranking with third-party libraries.

## Key Decisions

- Keep Raycast built-in fuzzy filtering by **not using** `onSearchTextChange`.
- Strengthen matching via `keywords` (normalized variants).
- Cache-first index on disk, background refresh when stale.
- Preview thumbnails generated via `/usr/bin/qlmanage -t` and cached locally.

## Acceptance Checklist

- First run builds an index and shows fonts found in standard directories.
- Family list: Enter copies Family name; actions can open styles list.
- Styles list: Enter still copies Family; extra actions copy other variants.
- Detail panel shows a Quick Look-generated thumbnail when available.
- `Cmd` + `R` rebuilds the index from both screens.
- Errors do not crash the command; failures show a Retry action.
