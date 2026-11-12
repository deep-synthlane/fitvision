# Accessibility (target: WCAG 2.1 AA)

## Automated (runs in CI: `pnpm e2e`, `apps/e2e/tests/a11y-responsive.spec.ts`)

- **axe-core 4.14.0**, WCAG 2.0/2.1 A + AA rules. Checked on: login, register, account deleted,
  dashboard, wardrobe, collections, add clothing, product detail, try-on start, try-on result,
  avatar, profile and privacy. Each page is checked at 390 px and 1280 px in light mode, and at
  1280 px in dark mode. A canary test plants a violation to prove the harness detects it.
- **Responsive:** no horizontal page scrolling at **320, 390, 768, 1280 and 1920 px** on all
  signed-in pages, including the open size-chart editor (the widest UI).
- Result on 2026-11-06: **0 violations**. Fixed during this pass: dark-theme contrast on the
  destructive button (white on `#f87171` was about 2.8:1; now `#b91c1c`, about 6.5:1), and the
  size-chart editor widening the page on phones.

Automated tools catch only part of WCAG. They can't judge reading order, sensible focus order,
meaningful alt text or the quality of announcements.

## Built in

- Skip link to `main#main`; landmarks (header/nav/main/footer); one `h1` per page.
- Every form control has a label. Errors are linked to their fields and announced (`aria-live`).
- Tabs, favourite toggles and view buttons expose state (`aria-current`, `aria-pressed`).
- The 3D avatar viewer can be rotated with the arrow keys and has a text description; the "Built
  from" list gives the same information as text.
- `prefers-reduced-motion` disables animation and auto-rotate. Light and dark themes.
- Camera flows (body scan, try-on photo) always offer a file-upload alternative.

## Manual checks still to do (before public launch)

- [ ] Keyboard-only pass through every flow (focus order, visible focus, no traps, especially in
      the scan camera steps and the size-chart editor).
- [ ] Screen reader pass: VoiceOver (iOS Safari, macOS Safari) and NVDA (Windows Firefox/Chrome).
- [ ] 200 % zoom and text-spacing override.
- [ ] Body-scan guidance for low-vision users (audio cues are not implemented).
