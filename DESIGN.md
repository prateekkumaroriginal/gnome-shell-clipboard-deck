# Design System

## Theme

A compact desktop command surface that appears during focused work in mixed ambient light. The interface follows the current GNOME light or dark theme, with dark mode shown in the initial concept. Visual density is deliberate and practical.

## Color

The strategy is restrained: neutral GNOME surfaces with one warm selection accent and a deep aubergine supporting accent.

```css
:root {
  --color-bg: oklch(0.16 0.008 285);
  --color-surface: oklch(0.22 0.010 285);
  --color-surface-raised: oklch(0.27 0.012 285);
  --color-ink: oklch(0.96 0.004 285);
  --color-muted: oklch(0.75 0.010 285);
  --color-primary: oklch(0.78 0.16 91);
  --color-accent: oklch(0.48 0.14 315);
  --color-danger: oklch(0.64 0.20 28);
}
```

GNOME Shell CSS does not reliably accept OKLCH values, so implementation CSS uses fixed sRGB equivalents while these tokens remain the source palette.

## Typography

Use the GNOME Shell system font. The popup title is 18 px semibold, item text is 14 px medium, and metadata is 12 px regular. Text previews use at most two lines.

## Layout

- Popup width: 440 px.
- Popup maximum height: 600 px or the active monitor height minus 96 px, whichever is smaller.
- Active-monitor placement: horizontally centered, 42% down from the top.
- Outer padding: 16 px.
- Search-to-list gap: 12 px.
- List item gap: 6 px.
- Item padding: 12 px.

## Shape and Depth

- Popup radius: 14 px.
- Search and item radius: 9 px.
- Use a strong popup shadow without an additional decorative border.
- Selected items use a 2 px warm outline plus a surface change.
- Avoid decorative translucency when the current Shell theme cannot render it cleanly.

## Components

### Clipboard Deck Popup

One modal Shell actor containing header, search, history list, and empty state. It closes on `Escape`, outside click, shortcut toggle, workspace change, or lock.

### Search

Always visible. Placeholder: “Search copied items or nicknames”. A query that starts with `#` searches without the marker and puts matching nicknames before matching clipboard content. Existing pin and recency order remains intact within each group. There is no leading search icon; the field is recognizable from its placement and placeholder. Focus is available immediately, with a blinking insertion caret, but arrow navigation works without requiring pointer focus.

### History Item

Shows a text preview or image thumbnail, optional searchable nickname, and pin state. Time metadata is omitted for active items. The nickname appears in warm accent text at the item’s top-left. A focused or hovered item shows hash, archive, and pin actions; an inactive pinned item shows only its pin; an inactive unpinned item shows no actions. Every item action uses the same 18 px hit target and centered 14 px symbolic icon, including a dedicated hash icon for nicknames. The rightmost pin uses one geometry, stroked when unpinned and solid-filled when pinned. The archive-box icon moves an item to the extension’s Recycle Bin. Permanent deletion retains the trash-can icon so the two actions remain visually distinct. The subtle background appears only while a control is hovered or focused. Destructive hover states use a clear crimson treatment. All clickable controls use the pointing-hand cursor.

### Privacy Control

Header icons open the Help guide, toggle capture pause, open a ban-circle clear-history confirmation, restore all archived items, open the extension’s Recycle Bin, and open Settings inline. Settings uses the established full-size Preferences layout as a Shell surface instead of launching a GTK application, keeping it immediate and out of the taskbar. The Recycle Bin uses a bin-with-recycling-arrows icon rather than the permanent-delete trash can. Confirming clear archives all active history. Archiving does not change the system clipboard. Recycle Bin entries remain recoverable for seven days; they display their expiry and offer Restore or permanent Delete, after which their unreferenced saved image files are removed. Paused state changes icon, label, and empty-state copy so it is not communicated by color alone.

### Settings

The gear hides the compact history popup and shows the established full-size Preferences design as a Shell actor. A back button and `Escape` return to history. Shortcut recording preserves the original key-cap dialog design and appears as a modal layer within the same Shell surface; it rejects duplicate shortcuts, reserved navigation keys, and unmodified typing keys. No separate application window or taskbar entry is created.

### Help Guide

The question-mark header control opens a compact attached panel. Its accent-yellow “Guide” title is followed by the currently configured keyboard shortcuts, a legend explaining every toolbar and item-action icon, and a local-storage privacy note. The panel appears beside the popup when space permits and overlays it on narrow monitors. `Escape` closes Help before it closes Clipboard Deck.

## Motion

Open and close use a 160 ms opacity plus small scale transition with an ease-out curve. Reduced-motion mode uses opacity only. Selection movement has no animation.
