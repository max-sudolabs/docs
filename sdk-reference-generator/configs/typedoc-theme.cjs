/**
 * Custom TypeDoc markdown theme for E2B SDK reference docs.
 * Cleans up generated markdown for Mintlify compatibility.
 */
const { MarkdownPageEvent } = require('typedoc-plugin-markdown')

function load(app) {
  // listen to the render event
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = processPageContents(page.contents)
  })
}

function processPageContents(text) {
  return joinTypeExpressions(
    removeStrayFences(
      removeMarkdownLinks(
        removeFirstNLines(convertH5toH3(removeLinesWithConditions(text)), 6)
      )
    )
  )
}

// Some JSDoc blocks end with a closing fence that has no opening one (after a
// "Deprecated" or "Constructs" note), which turns the rest of the page into a code
// block. A bare ``` outside a code block whose next non-blank line is a heading cannot
// open a block, so it is dropped.
function removeStrayFences(text) {
  const lines = text.split('\n')
  const out = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      if (!inFence && /^```\s*$/.test(line)) {
        let j = i + 1
        while (j < lines.length && lines[j].trim() === '') j++
        if (j >= lines.length || lines[j].startsWith('#')) continue
      }
      inFence = !inFence
    }
    out.push(line)
  }
  return out.join('\n')
}

// typedoc-plugin-markdown writes an optional parameter as `name`? and a composite type as
// separate code spans joined by escaped punctuation (`Promise`\<`boolean`\>), which render
// as several chips with the ? and the brackets outside them. Join each table cell or
// standalone line that is only a type expression into a single code span
// (`name?`, `Promise<boolean>`). Type keywords come out in italics (`S` *extends* *typeof*
// `Sandbox`) and join too. Prose cells never match, and fenced code is left alone.
const TYPE_TOKENS = [
  ['code', /`([^`\n]+)`/y],
  ['operator', /\*(typeof|keyof|extends)\*/y],
  ['escaped', /\\([<>|])/y],
  ['array', /\[\]/y],
  ['arrow', /=>/y],
  ['punct', /[(),:?]/y],
  ['space', /\s+/y],
]

function tokenizeTypeExpression(segment) {
  const tokens = []
  let i = 0
  while (i < segment.length) {
    let matched = false
    for (const [kind, rx] of TYPE_TOKENS) {
      rx.lastIndex = i
      const m = rx.exec(segment)
      if (m) {
        tokens.push({ kind, text: m[0], inner: m[1] })
        i = rx.lastIndex
        matched = true
        break
      }
    }
    if (!matched) return null
  }
  return tokens
}

function joinTypeExpression(segment, inTable) {
  // property tables put an anchor before the name: <a id="gid"></a> `gid`?
  const anchor = segment.match(/^\s*(<a id="[^"]*"><\/a>\s*)/)
  if (anchor) {
    const rest = segment.slice(anchor[0].length)
    const joined = joinTypeExpression(rest, inTable)
    return joined === rest ? segment : segment.slice(0, anchor[0].length) + joined.trimStart()
  }

  const trimmed = segment.trim()
  if (!trimmed.includes('`')) return segment
  const tokens = tokenizeTypeExpression(trimmed)
  if (!tokens) return segment

  // only type syntax joins spans; plain `a`, `b` lists are left as they are
  const hasCode = tokens.some((t) => t.kind === 'code')
  const hasJoiner = tokens.some(
    (t) =>
      t.kind === 'escaped' ||
      t.kind === 'array' ||
      t.kind === 'arrow' ||
      t.kind === 'operator' ||
      t.text === '?'
  )
  if (!hasCode || !hasJoiner) return segment

  let merged = ''
  for (const t of tokens) {
    if (t.kind === 'code' || t.kind === 'operator') merged += t.inner
    else if (t.kind === 'escaped')
      merged += t.inner === '|' && inTable ? '\\|' : t.inner
    else if (t.kind === 'space') merged += ' '
    else merged += t.text
  }
  // a union that starts with a pipe (\| `string` \| `Blob`) loses the leading pipe
  merged = merged.replace(/^\\?\|\s*/, '').trim()

  const lead = segment.match(/^\s*/)[0]
  const trail = segment.match(/\s*$/)[0]
  return `${lead}\`${merged}\`${trail}`
}

function joinTableRow(line) {
  // split on unescaped pipes; the first and last pieces are the row's outer edges
  const cells = line.split(/(?<!\\)\|/)
  return cells
    .map((cell, i) =>
      i === 0 || i === cells.length - 1 ? cell : joinTypeExpression(cell, true)
    )
    .join('|')
}

function joinTypeExpressions(text) {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      if (/^\s*\|.*\|\s*$/.test(line)) return joinTableRow(line)
      return joinTypeExpression(line, false)
    })
    .join('\n')
}

// makes methods in the sdk reference look more prominent
function convertH5toH3(text) {
  return text.replace(/^##### (.*)$/gm, '### $1')
}

// removes markdown-style links, keeps link text
function removeMarkdownLinks(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
}

function removeFirstNLines(text, n) {
  return text.split('\n').slice(n).join('\n')
}

// removes "Extends", "Overrides", "Inherited from" and "Constructs" sections
function removeLinesWithConditions(text) {
  const lines = text.split('\n')
  const filteredLines = []

  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].startsWith('#### Extends') ||
      lines[i].startsWith('###### Overrides') ||
      lines[i].startsWith('###### Inherited from')
    ) {
      // section length varies: with useCodeBlocks the target is rendered as
      // a fenced code block when the parent has no doc page (e.g. classes
      // extending the built-in Error), so a fixed line count would leave an
      // orphan closing fence behind
      i = indexAfterSectionBody(lines, i) - 1
      continue
    }

    if (lines[i].startsWith('###### Constructs')) {
      // "Constructs: Sandbox" only repeats the class name; in older SDK versions the
      // section also carries a stray closing fence from the JSDoc, which turns the rest
      // of the page into a code block. Drop the heading, the name and any bare fence.
      i++
      while (
        i < lines.length &&
        !lines[i].startsWith('#') &&
        /^(\s*|`{3}\s*|[A-Za-z_$][\w$.]*)$/.test(lines[i])
      ) {
        i++
      }
      i--
      continue
    }

    if (lines[i].startsWith('##### new')) {
      // avoid promoting constructors
      i += 1
      continue
    }

    filteredLines.push(lines[i])
  }

  return filteredLines.join('\n')
}

// returns the index of the first line after the section body starting at
// headingIndex (the next heading or thematic break), treating fenced code
// blocks as opaque
function indexAfterSectionBody(lines, headingIndex) {
  let i = headingIndex + 1
  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      i++
      while (i < lines.length && !lines[i].startsWith('```')) i++
      i++
      continue
    }
    if (lines[i].startsWith('#') || lines[i].startsWith('***')) break
    i++
  }
  return i
}

module.exports = { load, processPageContents, joinTypeExpressions, removeLinesWithConditions, removeStrayFences }

