# Clipboard Deck

## Register

product

## Users

The primary user is the owner of this Ubuntu GNOME 46 workstation. They work across code editors, browsers, terminals, and native desktop applications and want to reuse recently copied content without leaving the keyboard.

## Product Purpose

Clipboard Deck provides a Windows-style clipboard history on GNOME. After the user explicitly assigns a global shortcut in Preferences, it opens a focused flyout over the current application. The user can customize its action shortcuts, search or navigate recent content, paste it into the previous application, pin useful entries, and manage local history. Success means the third-most-recent item can be found and reused in a few seconds without touching the pointer.

## Brand Personality

Quiet, capable, trustworthy.

## Anti-references

- A top-bar dropdown that feels detached from the active task.
- A large dashboard or separate application window.
- Decorative glass effects, neon accents, or heavy animation.
- An interface that hides privacy state or stores unbounded history.
- A pixel-for-pixel copy of Microsoft visual assets.

## Design Principles

1. Keep the current task in place. The popup overlays the active application and returns focus predictably.
2. Make the keyboard path complete. Every primary action must work without a pointer.
3. Prefer honest behavior over fragile magic. Direct paste falls back to copy-only when focus safety is uncertain.
4. Make privacy state obvious. Pause, exclusions, retention, and clearing must be easy to understand.
5. Protect GNOME Shell responsiveness. Clipboard capture and persistence must stay bounded and non-blocking.

## Accessibility & Inclusion

Target WCAG 2.2 AA contrast. Selection must not depend on color or hover alone. Support keyboard-only use, screen-reader labels, large text without clipping, and reduced-motion preferences. Popup placement and focus behavior must remain predictable across multiple monitors.
