#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, realpathSync, renameSync,
  statSync, unlinkSync, writeFileSync
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const surfaces = ['application', 'storybook', 'isolated-fixture', 'static-analysis']
const results = ['passed', 'failed', 'blocked', 'not-run']
const revisions = ['base', 'head', 'both']
const priorities = ['P0', 'P1', 'P2', 'P3']
const labels = {
  application: 'Integrated application',
  storybook: 'Existing Storybook story',
  'isolated-fixture': 'Temporary isolated fixture',
  'static-analysis': 'Source inspection only',
  'changes-requested': 'Recommendation: request changes',
  'no-findings': 'No findings in the completed scope',
  incomplete: 'Incomplete: evidence remains unavailable',
  reproduced: 'Reproduced',
  'code-only': 'Code-only: not runtime verified',
  blocked: 'Blocked: unverified',
  compared: 'Design compared',
  'not-applicable': 'Design comparison not applicable',
  regression: 'Regression',
  'new-behavior-gap': 'Gap in intended new behavior',
  'code-concern': 'Source-level concern'
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function object(value, required, optional, at) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${at}: expected an object`)
  for (const key of required) requireValue(Object.hasOwn(value, key), `${at}.${key}: required field is missing`)
  for (const key of Object.keys(value)) requireValue([...required, ...optional].includes(key), `${at}.${key}: unknown field`)
}

function text(value, at) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${at}: expected a nonempty string`)
  return value
}

function choice(value, options, at) {
  requireValue(options.includes(value), `${at}: expected one of ${options.join(', ')}`)
}

function list(value, validate, at, minimum = 0) {
  requireValue(Array.isArray(value) && value.length >= minimum, `${at}: expected an array with at least ${minimum} entries`)
  value.forEach((entry, index) => validate(entry, `${at}[${index}]`))
}

function optionalList(value, key, validate, at) {
  if (Object.hasOwn(value, key)) list(value[key], validate, `${at}.${key}`)
}

function optionalText(value, key, at) {
  if (Object.hasOwn(value, key)) text(value[key], `${at}.${key}`)
}

function url(value, at) {
  text(value, at)
  let parsed
  try { parsed = new URL(value) } catch { throw new Error(`${at}: invalid URL`) }
  requireValue(['http:', 'https:'].includes(parsed.protocol), `${at}: only HTTP(S) links are allowed`)
  requireValue(!parsed.username && !parsed.password, `${at}: URLs must not contain credentials`)
  for (const key of parsed.searchParams.keys()) {
    requireValue(!/^(access_token|token|api_key|apikey|authorization|signature|x-amz-signature|x-goog-signature)$/i.test(key), `${at}: remove secret-bearing or signed URL parameters`)
  }
}

function link(value, at) {
  object(value, ['label', 'url'], [], at)
  text(value.label, `${at}.label`)
  url(value.url, `${at}.url`)
}

function viewport(value, at) {
  object(value, ['width', 'height', 'zoom'], [], at)
  for (const key of ['width', 'height', 'zoom']) {
    requireValue(Number.isFinite(value[key]) && value[key] > 0, `${at}.${key}: expected a positive finite number`)
  }
  requireValue(Number.isInteger(value.width) && Number.isInteger(value.height), `${at}: dimensions must be integer CSS pixels`)
}

function step(value, at) {
  object(value, ['action'], ['url', 'code', 'expected', 'observed'], at)
  text(value.action, `${at}.action`)
  if (Object.hasOwn(value, 'url')) url(value.url, `${at}.url`)
  for (const key of ['code', 'expected', 'observed']) optionalText(value, key, at)
}

function measurement(value, fields, at) {
  object(value, fields, [], at)
  fields.forEach(key => text(value[key], `${at}.${key}`))
}

function createAssets(inputFile) {
  const root = dirname(realpathSync(inputFile))
  const files = new Set([realpathSync(inputFile)])
  const images = new Map()
  const fixtures = new Map()

  function read(file, limit) {
    text(file, 'Asset file')
    requireValue(!isAbsolute(file) && !file.includes('\\'), `Asset must use a relative POSIX path: ${file}`)
    const resolved = realpathSync(resolve(root, file))
    const within = relative(root, resolved)
    requireValue(within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), `Asset escapes the input directory: ${file}`)
    const stat = statSync(resolved)
    requireValue(stat.isFile() && stat.size <= limit, `Asset must be a regular file no larger than ${limit} bytes: ${file}`)
    files.add(resolved)
    return readFileSync(resolved)
  }

  function image(file) {
    if (!images.has(file)) {
      const bytes = read(file, 20 * 1024 * 1024)
      let mime
      if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') mime = 'image/png'
      else if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') mime = 'image/jpeg'
      else if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) mime = 'image/gif'
      else if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp'
      requireValue(mime, `Unsupported image signature (use PNG, JPEG, GIF, or WebP): ${file}`)
      images.set(file, `data:${mime};base64,${bytes.toString('base64')}`)
    }
    return images.get(file)
  }

  function fixture(file) {
    if (!fixtures.has(file)) {
      requireValue(!basename(file).startsWith('.'), `Hidden/environment files are not fixture downloads: ${file}`)
      requireValue(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.sh', '.yml', '.yaml'].includes(extname(file).toLowerCase()), `Unsupported source/text fixture extension: ${file}`)
      const bytes = read(file, 1024 * 1024)
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      requireValue(!source.includes('\0'), `Fixture must be UTF-8 text without NUL bytes: ${file}`)
      fixtures.set(file, { source, href: `data:text/plain;charset=utf-8;base64,${bytes.toString('base64')}` })
    }
    return fixtures.get(file)
  }

  return { files, image, fixture }
}

function validate(report, assets) {
  const at = 'review'
  object(report, [
    'schemaVersion', 'title', 'repository', 'prUrl', 'headSha', 'baseSha',
    'reviewedAt', 'scope', 'summary', 'verdict', 'design', 'setup', 'findings',
    'scenarios', 'checks', 'limitations'
  ], ['fixtures'], at)
  requireValue(report.schemaVersion === 1, 'review.schemaVersion: only version 1 is supported')
  for (const key of ['title', 'repository', 'scope', 'summary']) text(report[key], `${at}.${key}`)
  url(report.prUrl, `${at}.prUrl`)
  for (const key of ['headSha', 'baseSha']) {
    requireValue(typeof report[key] === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(report[key]), `${at}.${key}: expected a full 40- or 64-character commit hash`)
  }
  text(report.reviewedAt, `${at}.reviewedAt`)
  requireValue(/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(report.reviewedAt) && Number.isFinite(Date.parse(report.reviewedAt)), 'review.reviewedAt: expected an ISO timestamp with timezone')
  choice(report.verdict, ['changes-requested', 'no-findings', 'incomplete'], `${at}.verdict`)
  list(report.setup, step, `${at}.setup`, 1)
  list(report.limitations, text, `${at}.limitations`)

  function image(value, where) {
    object(value, ['file', 'label', 'alt', 'caption'], [], where)
    for (const key of ['file', 'label', 'alt', 'caption']) text(value[key], `${where}.${key}`)
    assets.image(value.file)
  }

  object(report.design, ['status', 'summary', 'references'], ['evidence', 'measurements'], 'review.design')
  choice(report.design.status, ['compared', 'not-applicable', 'blocked'], 'review.design.status')
  text(report.design.summary, 'review.design.summary')
  list(report.design.references, link, 'review.design.references')
  optionalList(report.design, 'evidence', image, 'review.design')
  optionalList(report.design, 'measurements', (value, where) => measurement(value, ['label', 'design', 'base', 'head', 'notes'], where), 'review.design')
  if (report.design.status === 'compared') {
    requireValue(report.design.references.length > 0 && report.design.evidence?.length > 0, 'Compared design requires a reference and captured image evidence')
  }

  list(report.findings, (finding, where) => {
    object(finding, [
      'priority', 'verification', 'category', 'title', 'sources', 'explanation',
      'relevance', 'target', 'steps', 'expected', 'observed'
    ], ['evidence', 'measurements'], where)
    choice(finding.priority, priorities, `${where}.priority`)
    choice(finding.verification, ['reproduced', 'code-only', 'blocked'], `${where}.verification`)
    choice(finding.category, ['regression', 'new-behavior-gap', 'code-concern'], `${where}.category`)
    for (const key of ['title', 'explanation', 'relevance', 'expected', 'observed']) text(finding[key], `${where}.${key}`)
    list(finding.sources, link, `${where}.sources`, 1)
    list(finding.steps, step, `${where}.steps`, 1)
    object(finding.target, ['surface', 'label'], ['url', 'viewport', 'container', 'state'], `${where}.target`)
    choice(finding.target.surface, surfaces, `${where}.target.surface`)
    text(finding.target.label, `${where}.target.label`)
    if (Object.hasOwn(finding.target, 'url')) url(finding.target.url, `${where}.target.url`)
    if (Object.hasOwn(finding.target, 'viewport')) viewport(finding.target.viewport, `${where}.target.viewport`)
    for (const key of ['container', 'state']) optionalText(finding.target, key, `${where}.target`)
    optionalList(finding, 'evidence', image, where)
    optionalList(finding, 'measurements', (value, position) => measurement(value, ['label', 'base', 'head', 'expected'], position), where)
    if (finding.verification === 'reproduced') {
      requireValue(finding.target.surface !== 'static-analysis', `${where}: static analysis is not runtime reproduction`)
      for (const key of ['url', 'viewport', 'container', 'state']) {
        requireValue(Object.hasOwn(finding.target, key), `${where}.target.${key}: required for reproduced UI findings`)
      }
      requireValue(finding.evidence?.length > 0, `${where}: reproduced UI findings require screenshot evidence`)
    }
  }, 'review.findings')

  list(report.scenarios, (scenario, where) => {
    object(scenario, ['name', 'surface', 'revision', 'result', 'details'], ['url', 'viewport'], where)
    for (const key of ['name', 'details']) text(scenario[key], `${where}.${key}`)
    choice(scenario.surface, surfaces, `${where}.surface`)
    choice(scenario.revision, revisions, `${where}.revision`)
    choice(scenario.result, results, `${where}.result`)
    if (Object.hasOwn(scenario, 'url')) url(scenario.url, `${where}.url`)
    if (Object.hasOwn(scenario, 'viewport')) viewport(scenario.viewport, `${where}.viewport`)
  }, 'review.scenarios')

  list(report.checks, (check, where) => {
    object(check, ['command', 'revision', 'result', 'details'], [], where)
    text(check.command, `${where}.command`)
    text(check.details, `${where}.details`)
    choice(check.revision, revisions, `${where}.revision`)
    choice(check.result, results, `${where}.result`)
  }, 'review.checks')

  optionalList(report, 'fixtures', (fixture, where) => {
    object(fixture, ['file', 'label', 'description', 'destination'], [], where)
    for (const key of ['file', 'label', 'description', 'destination']) text(fixture[key], `${where}.${key}`)
    assets.fixture(fixture.file)
  }, 'review')

  const blocked = report.design.status === 'blocked'
    || report.findings.some(finding => finding.verification === 'blocked')
    || [...report.scenarios, ...report.checks].some(item => item.result === 'blocked')
  requireValue(!(blocked || report.verdict === 'incomplete') || report.limitations.length > 0, 'Blocked/incomplete reports require an explicit limitation')
  if (report.verdict === 'no-findings') requireValue(report.findings.length === 0 && !blocked, 'A no-findings verdict cannot contain findings or blocked checks')
  if (report.verdict === 'changes-requested') requireValue(report.findings.some(finding => finding.verification !== 'blocked'), 'Changes requested requires a reproduced or code-only finding')
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

const badge = (value, label = labels[value] ?? value) => `<span class="badge ${escape(value)}">${escape(label)}</span>`
const anchor = value => `<a href="${escape(value.url)}" target="_blank" rel="noopener noreferrer">${escape(value.label)}</a>`
const links = values => `<ul>${values.map(value => `<li>${anchor(value)}</li>`).join('')}</ul>`
const paragraph = value => `<p>${escape(value)}</p>`
const code = value => `<pre><code>${escape(value)}</code></pre>`
const viewportText = value => `${value.width} × ${value.height} CSS px; zoom ${value.zoom}%`

function definition(rows) {
  return `<dl>${rows.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${value}</dd>`).join('')}</dl>`
}

function table(title, headings, rows) {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escape(title)}"><table><thead><tr>${headings.map(heading => `<th scope="col">${escape(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function steps(values) {
  return `<ol class="steps">${values.map(value => `<li>${paragraph(value.action)}${value.url ? paragraphLink(value.url) : ''}${value.code ? code(value.code) : ''}${value.expected ? `<p><strong>Expected:</strong> ${escape(value.expected)}</p>` : ''}${value.observed ? `<p><strong>Observed:</strong> ${escape(value.observed)}</p>` : ''}</li>`).join('')}</ol>`
}

function paragraphLink(value) {
  return `<p>${anchor({ label: value, url: value })}</p>`
}

function images(values, assets) {
  if (!values?.length) return ''
  return `<div class="evidence">${values.map(value => `<figure><h4>${escape(value.label)}</h4><img src="${assets.image(value.file)}" alt="${escape(value.alt)}"><figcaption>${escape(value.caption)}</figcaption></figure>`).join('')}</div>`
}

function renderFinding(finding, index, assets) {
  const target = finding.target
  const details = [
    ['Surface', escape(labels[target.surface])],
    ['Route/story', escape(target.label)]
  ]
  if (target.url) details.push(['URL', anchor({ label: target.url, url: target.url })])
  if (target.viewport) details.push(['Viewport', escape(viewportText(target.viewport))])
  if (target.container) details.push(['Container', escape(target.container)])
  if (target.state) details.push(['State/data', escape(target.state)])
  return `<article id="finding-${index + 1}" class="priority-${finding.priority}">
    ${badge(finding.priority)}${badge(finding.verification)}${badge(finding.category)}
    <h3>${index + 1}. ${escape(finding.title)}</h3>
    ${links(finding.sources)}
    ${paragraph(finding.explanation)}
    <p><strong>Real-world relevance:</strong> ${escape(finding.relevance)}</p>
    ${definition(details)}
    <div class="retest"><h4>Manual reproduction / verification</h4>${steps(finding.steps)}</div>
    <p><strong>Expected:</strong> ${escape(finding.expected)}</p>
    <p><strong>Observed:</strong> ${escape(finding.observed)}</p>
    ${finding.measurements?.length ? table('Base and PR measurements', ['Measurement', 'Base', 'PR head', 'Expected'], finding.measurements.map(row => [row.label, row.base, row.head, row.expected])) : ''}
    ${images(finding.evidence, assets)}
  </article>`
}

function render(report, assets) {
  const findings = [...report.findings].sort((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority))
  const counts = priorities.map(priority => [priority, findings.filter(finding => finding.priority === priority).length]).filter(([, count]) => count > 0)
  const header = `<p class="eyebrow">PR review / evidence report</p><h1>${escape(report.title)}</h1>
    <p>${anchor({ label: report.repository, url: report.prUrl })}</p>
    ${badge(report.verdict)}${counts.map(([priority, count]) => badge(priority, `${count} ${priority}`)).join('')}
    ${paragraph(report.summary)}
    ${definition([
      ['Reviewed at', escape(report.reviewedAt)],
      ['Base', `<code>${escape(report.baseSha)}</code>`],
      ['PR head', `<code>${escape(report.headSha)}</code>`],
      ['Scope', escape(report.scope)]
    ])}`

  const fixtures = (report.fixtures ?? []).map(fixture => {
    const data = assets.fixture(fixture.file)
    return `<div class="panel"><h3>${escape(fixture.label)}</h3>${paragraph(fixture.description)}
      <p><strong>Save as:</strong> <code>${escape(fixture.destination)}</code></p>
      <a class="download" href="${data.href}" download="${escape(basename(fixture.file))}">Download ${escape(basename(fixture.file))}</a>
      <details><summary>View fixture source</summary>${code(data.source)}</details></div>`
  }).join('')

  const content = `<section id="setup"><h2>Manual retest setup</h2><div class="panel">${steps(report.setup)}</div>${fixtures}</section>
    <section id="findings"><h2>Findings</h2>
      ${findings.length ? findings.map((finding, index) => renderFinding(finding, index, assets)).join('') : '<p>No findings recorded. This is not a guarantee of correctness; see coverage and limitations.</p>'}
    </section>
    <section id="design"><h2>Design comparison</h2><div class="panel">
      ${badge(report.design.status)}${paragraph(report.design.summary)}
      ${report.design.references.length ? links(report.design.references) : ''}
      ${report.design.measurements?.length ? table('Design measurements', ['Measurement', 'Design', 'Base', 'PR head', 'Notes'], report.design.measurements.map(row => [row.label, row.design, row.base, row.head, row.notes])) : ''}
      ${images(report.design.evidence, assets)}
    </div></section>
    <section id="coverage"><h2>Coverage and checks</h2><div class="panel"><h3>Routes, stories, and scenarios</h3>
      ${report.scenarios.length ? table('Scenario coverage', ['Scenario', 'Surface', 'Revision', 'Result', 'Details'], report.scenarios.map(value => [value.name, labels[value.surface], value.revision, value.result, `${value.details}${value.viewport ? ` | ${viewportText(value.viewport)}` : ''}`])) : '<p>No scenarios were recorded.</p>'}
      ${report.scenarios.filter(value => value.url).map(value => `<p>${escape(value.name)}: ${anchor({ label: value.url, url: value.url })}</p>`).join('')}
      <h3>Command checks</h3>
      ${report.checks.length ? table('Command checks', ['Command', 'Revision', 'Result', 'Details'], report.checks.map(value => [value.command, value.revision, value.result, value.details])) : '<p>No command checks were recorded.</p>'}
    </div></section>
    <section id="limitations"><h2>Limitations / unverified behavior</h2><div class="panel">
      ${report.limitations.length ? `<ul>${report.limitations.map(value => `<li>${escape(value)}</li>`).join('')}</ul>` : '<p>No additional limitations were recorded.</p>'}
    </div></section>`

  const template = readFileSync(new URL('../templates/report.html', import.meta.url), 'utf8')
  const replacements = { TITLE: escape(report.title), HEADER: header, CONTENT: content }
  const used = new Set()
  const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    requireValue(Object.hasOwn(replacements, key), `Unknown template marker: ${key}`)
    used.add(key)
    return replacements[key]
  })
  requireValue(Object.keys(replacements).every(key => used.has(key)), 'Template is missing required markers')
  return html
}

function main() {
  requireValue(Number(process.versions.node.split('.')[0]) >= 20, 'Node.js 20 or later is required')
  const { values } = parseArgs({
    options: { input: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    strict: true, allowPositionals: false
  })
  if (values.help) {
    console.log('Usage: node render-report.mjs --input <review.json> --output <report.html>\nRequires Node.js 20+. Reads only local evidence; does not execute snippets or publish reviews.\nSee references/report-contract.md in the skill directory for the input format.')
    return
  }
  requireValue(values.input && values.output, 'Both --input and --output are required (use --help)')
  const input = resolve(values.input)
  const output = resolve(values.output)
  requireValue(extname(output).toLowerCase() === '.html', 'Output must use the .html extension')
  const report = JSON.parse(readFileSync(input, 'utf8'))
  const assets = createAssets(input)
  assets.files.add(realpathSync(fileURLToPath(import.meta.url)))
  assets.files.add(realpathSync(fileURLToPath(new URL('../templates/report.html', import.meta.url))))
  validate(report, assets)
  const resolvedOutput = existsSync(output) ? realpathSync(output) : output
  requireValue(!assets.files.has(resolvedOutput), 'Output must not overwrite the input JSON or an evidence/fixture file')
  const html = render(report, assets)
  mkdirSync(dirname(output), { recursive: true })
  const temporary = resolve(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, html, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, output)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  console.log(`Created ${output} (${Buffer.byteLength(html)} bytes; ${report.findings.length} findings).`)
  console.log('Rendered locally. Review claims and reproduction snippets still require independent verification.')
}

try {
  main()
} catch (error) {
  console.error(`render-report: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
