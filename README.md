# PX Agent Skills

Reusable skills and custom agents for AI coding agents (GitHub Copilot, Claude Code, and other tools that support `SKILL.md`), maintained by the PX team.

## Layout

```
skills/<skill-name>/   # SKILL.md plus optional references/, scripts/, templates/
agents/                # custom agent definitions (coming soon)
```

## Skills

| Skill | Description |
| --- | --- |
| [`pr-review-report`](skills/pr-review-report/SKILL.md) | Reviews a pull request (optionally against a Figma design), verifies base/head behavior in the running app or Storybook, and produces a self-contained offline `report.html`. Never posts to GitHub by default. |

## Install

Clone once, then copy or symlink skills into your agent's skills directory:

```sh
git clone https://github.com/bahag-usovich/px-agent-skills.git
mkdir -p ~/.agents/skills
ln -s "$PWD/px-agent-skills/skills/pr-review-report" ~/.agents/skills/pr-review-report
```

Use `~/.copilot/skills`, `~/.claude/skills`, or a repository-local `.github/skills` directory if your tool expects a different location. Invoke a skill by name, e.g. `/pr-review-report <PR URL>`.

### Requirements

- `pr-review-report`: Node.js 20+ for `scripts/render-report.mjs` (no package installation needed). Figma MCP and browser tooling are used when available.

## Contributing

1. Add a new folder under `skills/` (or a file under `agents/`).
2. Include a `SKILL.md` with `name` and `description` frontmatter.
3. Keep skills free of secrets, tokens, and project-internal URLs.
4. Add a row to the table above and open a pull request.
