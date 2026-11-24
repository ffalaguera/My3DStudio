# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary (confirmed 2026-11-21): **3D-printing makers** — people who print figures, tabletop miniatures, garden-railway scenery,
replacement parts and gifts on FDM or resin printers at home. They have a photo or an idea and want a printable file (STL or
3MF) without learning to model. In the research they were the group with the most concrete use mentions (17 reviews) and the
one that suffers most from download paywalls and wasted credits.

Secondary: indie game developers who need GLB/FBX for Godot, Unity or Blender, and occasional users converting a few photos
(gifts, keepsakes, AR) without a subscription. Interface copy is Spanish (Spain), `es-ES`.

## Product Purpose

My3DStudio turns one photo, or a sentence, into a textured 3D model you can view in the browser and download as GLB, OBJ,
STL, 3MF, FBX or USDZ. Success: a maker gets a file their slicer accepts, having known the price before generating, and
never pays for something they could not download.

## Positioning

"Pay only for what you generate." Honest billing is the mechanism competitors break: the credit cost is shown on the
Generate button before anything runs; credits are frozen and returned automatically if a generation fails or is cancelled;
every model downloads in every format, with no export paywall; unused monthly credits roll over one month and credit packs
never expire; cancelling a subscription is a button in the account page with no retention flow. There are no free
generations: every model is paid in advance (packs from 3 € for 3 models), so the business never loses money per model.

## Operating Context

- Flow: upload an image (JPG/PNG/WEBP, ≤ 20 MB, ≥ 256 px) or write a prompt → see the cost → generate (queued, live progress
  over SSE, typically under a minute to a few minutes) → orbit the result in a three.js viewer → download.
- Two modes: high detail (dense mesh) and clean topology (polygon budget 500–25,000, 1/2/4 variants), 2K/4K/8K textures.
- Library ("Mis modelos") with search, filters, privacy and deletion; account page with credit ledger.
- Makers judge results by whether the mesh is closed and prints at the right size; 3MF is exported in millimetres.

## Capabilities and Constraints

- Stack: Angular 21 (standalone + signals), Tailwind 3 with a token preset generated from `replica/design/tokens.json`,
  three.js viewer, Lucide icons via an own registry. API: Express 5 + Postgres; generation through fal (TRELLIS.2, FLUX.1
  schnell for text), about 0.28 € per model.
- Plans: "Pago por uso" (no monthly credits), Creador 15 €/month (1,500 credits ≈ 30 models), Estudio 49 €/month
  (5,000 credits); packs of 3/10/30/90 €; one high-detail model = 50 credits. Payments via Stripe are built but switched off
  until the owner creates the account.
- Strict CSP (no inline scripts, no third-party scripts except Google sign-in when enabled); self-hosted fonts only.
- Undecided: final domain; whether the name "My3DStudio" survives a trademark review (close to "3D AI Studio").

## Brand Commitments

- Name: My3DStudio (user's choice; trademark risk documented in `replica/brand.md`).
- Voice (from `replica/brand.md`): clear, not cold; honest, not alarmist; close, not chummy. Short sentences, prices stated
  up front, no exclamation-mark hype, no emojis, tú form.
- The current teal palette and cube favicon are provisional from the rebrand step, not a binding identity.
- Never use the original competitor's name, logo, colours or screenshots anywhere in the product or marketing.

## Evidence on Hand

- Real product UI: the running app (workspace, viewer, library, pricing, account).
- Real 3D models: to be generated with the production engine for the showcase (approved 2026-11-21, 4–6 models).
- No testimonials, user counts, ratings, press or customer logos exist. Do not fabricate them. Competitor reviews in
  `replica/reviews.csv` are research only and must never appear as testimonials.

## Product Principles

1. The price is visible before the action, never after.
2. What you pay for is yours: download in every format, keep it private, use it commercially.
3. Show the real thing: real models, real interface, no invented proof.
4. Printability first: the file must work in a slicer, not just look good in a render.
5. No dark patterns: leaving is as easy as joining.

## Accessibility & Inclusion

WCAG 2.1 AA: axe checks run in the e2e suite on key screens; full keyboard operation of the generate flow; visible focus;
respect `prefers-reduced-motion`.
