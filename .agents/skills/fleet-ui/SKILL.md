---
name: fleet-ui
description: Design, build, or review a VHH Fleet screen or reusable UI pattern in the web administration dashboard or Expo driver app. Use for layout, interaction, or design system changes; skip backend work and isolated copy or typo fixes.
---

# Fleet UI

Resolve the repository paths below from the Fleet root.

1. **Read the current contract.** Open `DESIGN.md`, the matching feature doc, and the route and shared components for the surface you are changing. Identify the employee's task, the main action, and the states that change what they can do. Historical Figma prototypes can contain deferred features; check the current scope in `README.md`.
2. **Find the closest precedent.** For an existing pattern, start with Fleet's own screens. For a new or substantially changed pattern, read the relevant part of `design/mobbin-references.md`. If more evidence is needed, use the connected Mobbin search for one concrete screen or flow per platform. Inspect the images and record the pattern worth bringing into Fleet, the canonical link, and what stays specific to Fleet. If Mobbin is unavailable, use the saved references and state the limitation.
3. **Build with the shared kit.** Briefly state the intended hierarchy and main interaction. Reuse Fleet's components and tokens. Keep behavior, permissions, and data claims aligned with the product contract. If asked to review only, inspect and report findings without editing; otherwise implement the requested change.
4. **Verify the rendered result.** Use `design/quality-checklist.md` for browser or simulator commands and the review criteria. Capture and inspect actual app states, exercise the primary path and a relevant recovery state, then address material defects and recheck. Report what ran, the evidence paths, and any state or platform you could not verify.

Record user-approved reusable design decisions in `DESIGN.md`. Add useful inspected precedents to the reference library, with their scope. Keep device evidence separate from rules and feature specs.
