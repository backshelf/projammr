## What and why

<!-- What this changes and the reason for it. Link the issue it addresses, if there is one. -->

## How it was tested

<!-- Tests added or changed, and anything you checked by hand. -->

## Checklist

- [ ] The title follows Conventional Commits: `type(scope): summary`
- [ ] `bun run lint`, `bun run typecheck`, `bun run build` and `bun run test` pass, and so does `cd apps/server && bun run test` if the server changed
- [ ] New behaviour has tests, including the error case
- [ ] Generated files are regenerated and committed (`bun run typegen`) if a route or an enum changed
- [ ] The matching `docs/agents/` reference is updated if an area's structure changed
- [ ] Before and after screenshots are attached if a screen changed
