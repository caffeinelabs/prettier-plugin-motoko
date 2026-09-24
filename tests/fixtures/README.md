# Parser fixtures

Rare constructs the corpus may not cover. Every file must parse and round-trip exactly (`tests/parser.test.ts`).

- `head-mode.mo`: expressions in an unparenthesised control head, including the kinds aliased back to their bare names.
- `objects-and-fields.mo`: object bodies, records, classes, actors, mixins and every field form.
- `control-flow.mo`, `async-and-await.mo`, `declarations.mo`, `patterns.mo`, `types.mo`, `literals.mo`: one file per area.
