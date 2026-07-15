# Coding Standards

These standards optimize NullTrace for clear human navigation and predictable AI changes. Apply them to all new code immediately. Bring existing code into compliance only when a change substantially touches the relevant module; do not mix broad cleanup into unrelated feature work.

## Organize by Feature and Concept

- Keep the feature-based architecture. A feature owns the modules that describe its domain behavior.
- Every file name must state both its owning concept and its role. Use names such as `finding.repository.ts`, `action-draft-workspace.helpers.ts`, and `nuclei-finding.mapper.ts`.
- Do not create catch-all application files named `helpers.ts`, `utils.ts`, `types.ts`, `mapper.ts`, or similar. A helper, type, or mapper file must be scoped to its concept in its filename.
- Prefer direct imports from the real module file. Do not add application-code barrel files (`index.ts` files that re-export a folder).
- Use the existing role vocabulary when it fits: `component`, `service`, `repository`, `mapper`, `helpers`, `types`, `hook`, `config`, `data`, `store`, and `screen`. Introduce a new role only when it expresses a real, stable responsibility.

## Give Every Concept a Clear Starting Point

- A non-trivial concept must have a clearly named primary module. A reader should be able to open that file first to understand the workflow or public behavior.
- Supporting modules must have a specific role. `*.helpers.ts` is deliberately secondary implementation detail; readers should not need to open it to understand the primary workflow.
- Split a module when part of it has a coherent, independently nameable responsibility, or when another module needs it. Do not split solely because a file crosses a line-count threshold.
- Do not combine unrelated responsibilities behind a vague name. For example, payload decoding, validation, and scanner-specific workspace mutation are separate concerns even if they were initially implemented together.

## Types and Public Interfaces

- Every exported interface and type alias belongs in a concept-scoped `*.types.ts` file.
- A `*.types.ts` file contains TypeScript contracts only: interfaces, type aliases, and closely related type-level constants. It must not contain classes, repositories, runtime functions, or other runtime implementation.
- Small private types may stay in their implementation file when they are inseparable from that implementation. Put them near the code they describe, not mechanically at the end of a file.
- Treat `export` as an explicit public-interface decision. Export only what another module must use; keep implementation details private.
- Use named exports only. Do not use default exports.

## Services, Classes, Methods, and Helpers

- Use a class only when the module owns dependencies, state, or lifecycle. Repositories with a database dependency are a typical example.
- A `*.service.ts` file contains its service class only. Do not place top-level helper functions beside the class.
- Use a private class method when the behavior needs the instance, its state, or one of its injected dependencies (`this`).
- Use a function in the matching concept-scoped `*.helpers.ts` file when the behavior is independent of an instance, especially for pure transformation, parsing, or validation logic.
- A helper module may export functions needed by its primary module. That does not make the helpers part of a feature-wide catch-all API.

## File Order

Primary implementation modules follow this order:

1. Imports.
2. The primary exported class or function, so the public workflow is visible first.
3. Private implementation detail only when it belongs in the same file.

In practice, services contain only imports and their class. Independent helper functions belong in the matching `*.helpers.ts` module.

## Refactoring Existing Code

- Prefer small, behavior-preserving refactors that clarify one concept at a time.
- Do not use style cleanup as a reason to change behavior or broaden a feature change.
