# Report data contract

Run the renderer with Node.js 20+:

```sh
node <skill-dir>/scripts/render-report.mjs --input <artifacts>/review.json --output <artifacts>/report.html
```

The renderer reads local files only. It accepts JSON, not arbitrary HTML or
Markdown. All text is escaped; use the structured link/code fields below.
Unknown fields, invalid values, unreadable assets, and unsafe URLs are errors.
It validates report structure, **not the truth of the findings**.

## Top-level fields

| Field | Required | Value |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `title` | yes | Report title |
| `repository` | yes | Repository name, normally `owner/repo` |
| `prUrl` | yes | Canonical PR URL |
| `headSha`, `baseSha` | yes | Full inspected Git hashes: 40 or 64 hexadecimal characters |
| `reviewedAt` | yes | ISO 8601 timestamp with timezone |
| `scope` | yes | What was reviewed and excluded |
| `summary` | yes | Concise evidence-based outcome |
| `verdict` | yes | `changes-requested`, `no-findings`, or `incomplete` |
| `design` | yes | Design object below; explicit even for code-only reports |
| `setup` | yes | Nonempty array of numbered steps |
| `findings` | yes | Array of finding objects, or `[]` |
| `scenarios` | yes | Coverage array, or `[]` when nothing ran |
| `checks` | yes | Command-check array, or `[]` |
| `limitations` | yes | Array of nonempty strings, possibly `[]` |
| `fixtures` | no | Array of downloadable local text/source files |

`changes-requested` requires a reproduced or code-only finding.
`no-findings` requires no findings and no blocked design, scenarios, or checks.
It means “no findings in the completed scope,” not proof of bug-free software.
A blocked design/scenario/check or finding requires an explicit limitation.
`incomplete` requires a limitation explaining the missing evidence.
Findings are displayed in priority order, retaining input order within a priority.

## Shared objects

**Link:** `{ "label": "Inspected source", "url": "https://..." }`.
Only HTTP(S) links without embedded credentials are accepted. Use stable
commit/line links for source, canonical design URLs, and explicitly local
app links. Never include secret-bearing URLs.

**Step:** `{ "action": "Open the story", "url": "http://localhost:6006/iframe.html?id=...", "code": "optional copyable command", "expected": "optional expected result", "observed": "optional measured result" }`.
Only `action` is required. Steps render as a numbered list. Code is displayed,
not executed. Include startup instructions if the URL needs a local server.

**Image:** `{ "file": "evidence/before.png", "label": "Base", "alt": "Both items are visible", "caption": "Actual screenshot conditions and what it proves" }`.
All four fields are required. No remote image URLs. Supported formats are
PNG, JPEG, GIF, and WebP, detected by signature; SVG is not embedded.
Each file must be at most 20 MiB.

**Viewport:** `{ "width": 1024, "height": 900, "zoom": 100 }`.
All fields are required and positive. Dimensions are integer CSS pixels;
zoom is a percentage.

Paths must be relative to the input JSON directory and remain inside it,
including after resolving symlinks. Copy needed evidence there first.
The output must have an `.html` extension and cannot overwrite the input,
a referenced asset, or the skill's renderer/template.

## Design object

- `status`: `compared`, `not-applicable`, or `blocked`.
- `summary`: explain the design reference/scope, confirmed code-only decision,
  or exact blocker.
- `references`: array of links; nonempty for `compared`.
- Optional `evidence`: array of images. Required and nonempty for `compared`.
- Optional `measurements`: array of objects with required string fields
  `label`, `design`, `base`, `head`, and `notes`.

Use `compared` only after a real comparison, not because Figma metadata was
retrieved. If the selected design cannot be verified, use `blocked` and an
incomplete outcome unless other supported findings justify changes.

## Finding object

| Field | Required | Value |
|---|---|---|
| `priority` | yes | `P0`, `P1`, `P2`, or `P3` |
| `verification` | yes | `reproduced`, `code-only`, or `blocked` |
| `category` | yes | `regression`, `new-behavior-gap`, or `code-concern` |
| `title` | yes | Concrete issue title |
| `sources` | yes | Nonempty link array; distinguish changed code and consumer evidence |
| `explanation` | yes | Supported cause and impact |
| `relevance` | yes | Why this scenario matters; identify synthetic-only evidence |
| `target` | yes | Target object below |
| `steps` | yes | Nonempty numbered reproduction/verification steps |
| `expected` | yes | Intended behavior and its basis |
| `observed` | yes | Measured result, source reasoning, or exact blocker |
| `measurements` | no | Array of `{ "label", "base", "head", "expected" }`, all strings |
| `evidence` | no | Image array; nonempty for reproduced UI findings |

Priority meanings: `P0` universal immediate blocker; `P1` high-impact regression;
`P2` normal correctness/behavior issue; `P3` minor issue. Use the repository's
severity conventions when they define a more specific mapping.

The target contains:

- Required `surface`: `application`, `storybook`, `isolated-fixture`, or
  `static-analysis`.
- Required `label`: exact route/story name, or source area.
- Optional `url`, `viewport`, `container`, `state`.
- For **reproduced** UI findings, all four optional fields become required.
  State the actual container geometry, not an unexplained invented constraint.
- `static-analysis` cannot be marked `reproduced`.

`code-only` is a supported code concern, not a claim of runtime reproduction.
If browser work is blocked, record what is known separately from the prediction.
Do not put “not reproduced” candidates among confirmed bugs; include those
attempts in scenarios or limitations.

## Coverage and checks

**Scenario:** required `name`, `surface`, `revision`, `result`, `details`;
optional `url` and `viewport`. Surface uses the target values above.
Revision is `base`, `head`, or `both`. Result is `passed`, `failed`, `blocked`,
or `not-run`. Details should include actual environment and what was checked,
including mouse emulation versus actual touch where relevant.

**Check:** required `command`, `revision`, `result`, `details`; revision and
result have the same values as scenarios. Record exact commands and actual
outcomes; do not list checks that were not performed as passed.

## Optional fixture downloads

Each fixture has required `file`, `label`, `description`, and `destination`.
The source must be UTF-8 text without NUL bytes, at most 1 MiB. Its exact bytes
are embedded as a downloadable text file; the content is also shown escaped.
`destination` describes where the reader should save it in their checkout.
Include installation/startup/cleanup steps in `setup`. Do not embed secrets,
environment files, or unrelated source trees.

## Minimal illustrative example

This is synthetic data, not a real finding. Replace every example value with
inspected evidence. A UI finding additionally needs its viewport, state,
container, and actual screenshot evidence.

```json
{
  "schemaVersion": 1,
  "title": "Widget PR review",
  "repository": "example/ui",
  "prUrl": "https://github.com/example/ui/pull/42",
  "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "baseSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "reviewedAt": "2026-01-01T12:00:00Z",
  "scope": "Changed widget API; no integrated application verification.",
  "summary": "Source inspection identifies a possible caller compatibility issue.",
  "verdict": "changes-requested",
  "design": {
    "status": "not-applicable",
    "summary": "The user confirmed code-only review of this API change.",
    "references": []
  },
  "setup": [
    { "action": "Open the inspected PR head in an isolated source snapshot." }
  ],
  "findings": [
    {
      "priority": "P2",
      "verification": "code-only",
      "category": "code-concern",
      "title": "Existing callers may omit the newly required value",
      "sources": [
        {
          "label": "Changed widget contract",
          "url": "https://github.com/example/ui/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/widget.ts#L10"
        }
      ],
      "explanation": "Describe the actual inspected contract and affected caller.",
      "relevance": "Identify the inspected consumer; do not invent one.",
      "target": {
        "surface": "static-analysis",
        "label": "Widget contract and existing caller"
      },
      "steps": [
        { "action": "Compare the changed contract with the pinned caller source." }
      ],
      "expected": "State the intended compatibility guarantee.",
      "observed": "State the actual source-level mismatch, not a runtime claim."
    }
  ],
  "scenarios": [],
  "checks": [],
  "limitations": [
    "This example has no runtime verification."
  ]
}
```
