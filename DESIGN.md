# nono & txx · Interface System

## Direction

The site is a quiet, long-lived relationship archive. Content leads; interface chrome recedes. The visual world is warm paper, dark brown-black ink, and one muted wine accent used only for state, dates, and destructive recovery.

## Core Tokens

- Background: `#f8f7f4`
- Surface: `#ffffff`
- Ink: `#24211f`
- Secondary text: `#675f59` or darker
- Hairline: `#ded9d2`
- Accent: `#7e2f40`
- Accent wash: `#f3e9eb`
- Small radius: `8–10px`; dialog radius: `18px`
- Elevation is reserved for dialogs and actively lifted photographs. Ordinary content uses rules and spacing instead of card shadows.

## Typography

- Display: Georgia / Songti fallback, light-to-regular weight, tight tracking.
- Interface and body: native system sans with PingFang SC fallback.
- Page display title: `50–96px`, responsive.
- Section title: `36–58px`.
- Narrative body: minimum `14px`.
- Functional labels: minimum `11px`; never use tiny text to simulate refinement.

## Layout

- Desktop content width: up to `1200–1360px`, with full-bleed photographic rails.
- Desktop and tablet retain two continuous photo rows.
- Mobile keeps the two-row mechanism, reduces card dimensions, and collapses the timeline to one narrative column.
- Spacing separates chapters. Borders only clarify a boundary; nested cards are avoided.

## Memories Page

- Two photo rails move continuously at slightly different speeds; the second row begins offset.
- Hover or keyboard focus pauses the rails and gently lifts the selected image.
- A visible pause/resume control is always available. `prefers-reduced-motion` disables automatic movement and leaves manual horizontal browsing.
- A selected photograph exposes a concise date and title, while each photograph carries a descriptive accessible name.
- The timeline is a chronological narrative list: date, title, excerpt, then up to three event thumbnails.
- The approved vertical connector between photo and timeline was removed at the user's request. Association is communicated through selected-photo metadata and event content instead.

## Management and Safety

- “Manage photos” opens a focused dialog showing the exact photo that would be deleted, including its title, date, source, and preview.
- Deleting a photo, event image, or event provides a seven-second undo action.
- Add, edit, delete, year filters, photo viewer, and persistence remain real IndexedDB-backed behaviors.
- Browser-local storage must be described honestly; it is not cross-device synchronization.

## Motion

- Entry motion is short, staggered, and already-visible by default.
- Hover motion is limited to a small vertical lift and neutral shadow.
- Dialogs use a short fade-and-rise transition.
- Avoid large blur, large zoom, springy motion, and repeated decorative reveals.
- Under `prefers-reduced-motion`, transitions collapse and continuous movement stops.

## Browser Surfaces

- Selection, focus rings, file inputs, dialogs, and status toasts use the same palette.
- Keyboard focus is always visible.
- Dialog close controls use a rounded square, not an unexplained circular icon.

## Content Truths

- Product name: `nono & txx`.
- Relationship start date: `2025.09.17`.
- The secret-page password is a separate product setting and must never be presented as the relationship start date.
