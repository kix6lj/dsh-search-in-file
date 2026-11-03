/**
 * Find inside the right Sidebar: the open document preview and the
 * changes-review diff.
 *
 * The browser's own find searches the whole application DOM — chat history,
 * sidebar, composer and all. This plugin puts a find bar on the surface being
 * read and highlights matches in place. It never moves the document selection,
 * so typing keeps its focus; matches are painted with the CSS Custom Highlight
 * API and belong to the surface that painted them.
 */
window.__ModuleLoader__.load({
  id: 'dsh-search-in-file',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const { createRoot } = require('react-dom/client')

    const h = React.createElement

    /** Renderers whose body is a text preview owned by TextPreview. */
    const RENDERER_IDS = [
      '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
      '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown',
      '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code',
    ]

    /** Root of one changes-review tab (the deliverables diff view). */
    const REVIEW_ROOT = '[data-changes-review]'
    /** One stable toolbar control whose parent is the review's tools row. */
    const REVIEW_TOOL = '[data-review-tool="wrap"]'

    /** Upper bound on collected matches. */
    const MAX_MATCHES = 1000
    /** Header height shared by the document preview and the review tab. */
    const HEADER_HEIGHT = 38

    const STYLES = `
.dsh-search-in-file-toggle{width:28px;height:28px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:6px;line-height:1;display:inline-flex}
.dsh-search-in-file-toggle:hover,.dsh-search-in-file-toggle[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-search-in-file-panel{position:fixed;z-index:900;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#f7f7f8);border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));box-shadow:0 8px 24px rgba(0,0,0,.14);color:var(--dsw-alias-label-primary,#1a1a1a);font-family:var(--dsw-font,sans-serif);font-size:13px;display:flex;flex-direction:column;overflow:hidden}
.dsh-search-in-file-row{box-sizing:border-box;flex:none;align-items:center;gap:4px;height:38px;padding:0 6px;display:flex}
.dsh-search-in-file-input{box-sizing:border-box;flex:1;min-width:0;height:26px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;outline:none}
.dsh-search-in-file-input:focus{border-color:var(--dsw-alias-label-secondary,#888)}
.dsh-search-in-file-input[data-invalid="true"]{border-color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsh-search-in-file-count{color:var(--dsw-alias-label-secondary,#666);font-size:12px;white-space:nowrap;min-width:42px;text-align:right;font-variant-numeric:tabular-nums}
.dsh-search-in-file-tool{width:26px;height:26px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm,4px);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:5px;line-height:1;display:inline-flex}
.dsh-search-in-file-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-search-in-file-tool:disabled{opacity:.4;cursor:default}
.dsh-search-in-file-tool[aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-search-in-file-review-host{display:inline-flex;align-items:center}
::highlight(dsh-search-in-file-all-preview){background-color:rgba(255,214,0,.42);color:inherit}
::highlight(dsh-search-in-file-current-preview){background-color:rgba(255,150,0,.72);color:inherit}
::highlight(dsh-search-in-file-all-review){background-color:rgba(255,214,0,.42);color:inherit}
::highlight(dsh-search-in-file-current-review){background-color:rgba(255,150,0,.72);color:inherit}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-dsh-search-in-file]') !== null) return
      const style = document.createElement('style')
      style.dataset.dshSearchInFile = 'true'
      style.textContent = STYLES
      document.head.appendChild(style)
    }

    /** Word characters for whole-word matching. */
    const WORD_CHAR = /[\p{L}\p{N}_]/u

    /** Browser-local preferences for the find bar. */
    const OPTIONS_KEY = 'dsh.find.options.v1'

    /**
     * Read the remembered switches.
     * @returns the three boolean options.
     */
    function loadOptions() {
      const fallback = { caseSensitive: false, wholeWord: false, regex: false }
      try {
        const raw = window.localStorage.getItem(OPTIONS_KEY)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        return {
          caseSensitive: parsed.caseSensitive === true,
          wholeWord: parsed.wholeWord === true,
          regex: parsed.regex === true,
        }
      } catch {
        return fallback
      }
    }

    /**
     * Remember the switches for the next bar.
     * @param options - the options to persist.
     */
    function saveOptions(options) {
      try {
        window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
      } catch {
        // Storage may be unavailable; the bar still works for this session.
      }
    }

    /**
     * The three switches, shared by both surfaces and persisted per browser.
     * @returns the current options and a patch function.
     */
    function useFindOptions() {
      const [options, setOptions] = React.useState(loadOptions)
      const update = React.useCallback((patch) => {
        setOptions((previous) => {
          const next = { ...previous, ...patch }
          saveOptions(next)
          return next
        })
      }, [])
      return [options, update]
    }

    /**
     * Whether a match is bounded by non-word characters on both sides.
     * @param text - the searched text.
     * @param at - match start.
     * @param length - match length.
     * @returns true when both edges sit on a word boundary.
     */
    function isWholeWord(text, at, length) {
      const before = at > 0 ? text[at - 1] : ''
      const after = at + length < text.length ? text[at + length] : ''
      return !WORD_CHAR.test(before) && !WORD_CHAR.test(after)
    }

    /**
     * Build the matcher for one query and its switches. A regex that does not
     * compile answers with its error instead of matches.
     * @param query - the typed query.
     * @param options - case, whole-word and regex switches.
     * @returns an object with matches(text), or with the compile error.
     */
    function createMatcher(query, options) {
      if (query === '') return { matches: () => [] }
      if (options.regex === true) {
        let regex
        try {
          // Multiline keeps ^ and $ anchored to each line and paragraph, which is
          // what a find bar searches; without it they only match the whole text.
          regex = new RegExp(query, options.caseSensitive === true ? 'gm' : 'gim')
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
        return {
          matches(text) {
            const found = []
            regex.lastIndex = 0
            for (;;) {
              const match = regex.exec(text)
              if (match === null) break
              if (match[0].length === 0) {
                regex.lastIndex += 1
                continue
              }
              if (options.wholeWord !== true || isWholeWord(text, match.index, match[0].length)) {
                found.push({ at: match.index, length: match[0].length })
              }
            }
            return found
          },
        }
      }
      const needle = options.caseSensitive === true ? query : query.toLowerCase()
      if (needle === '') return { matches: () => [] }
      return {
        matches(text) {
          const found = []
          const hay = options.caseSensitive === true ? text : text.toLowerCase()
          let from = 0
          for (;;) {
            const at = hay.indexOf(needle, from)
            if (at === -1) break
            if (options.wholeWord !== true || isWholeWord(text, at, needle.length)) found.push({ at, length: needle.length })
            from = at + Math.max(needle.length, 1)
          }
          return found
        },
      }
    }

    /** Whether this engine supports the CSS Custom Highlight API. */
    const canHighlight =
      typeof CSS !== 'undefined' &&
      CSS.highlights !== undefined &&
      typeof CSS.highlights.set === 'function' &&
      typeof Highlight !== 'undefined'

    /**
     * Paint one surface's matches. The current match gets its own registry so
     * it stays distinguishable from the rest.
     * @param surface - `preview` or `review`.
     * @param ranges - every match range.
     * @param current - index of the focused match.
     */
    function paint(surface, ranges, current) {
      if (!canHighlight) return
      if (ranges.length === 0) {
        clearPaint(surface)
        return
      }
      CSS.highlights.set(`dsh-search-in-file-all-${surface}`, new Highlight(...ranges))
      const hit = ranges[current]
      if (hit === undefined) CSS.highlights.delete(`dsh-search-in-file-current-${surface}`)
      else CSS.highlights.set(`dsh-search-in-file-current-${surface}`, new Highlight(hit))
    }

    /**
     * Drop one surface's registries.
     * @param surface - `preview` or `review`.
     */
    function clearPaint(surface) {
      if (!canHighlight) return
      CSS.highlights.delete(`dsh-search-in-file-all-${surface}`)
      CSS.highlights.delete(`dsh-search-in-file-current-${surface}`)
    }

    /**
     * The nearest vertically scrollable ancestor of one node.
     * @param node - starting element.
     * @returns the scrollport, or undefined when the page scrolls instead.
     */
    function scrollportOf(node) {
      let current = node
      while (current !== null && current !== document.body) {
        const style = window.getComputedStyle(current)
        if (/(auto|scroll)/u.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1) return current
        current = current.parentElement
      }
      return undefined
    }

    /**
     * Scroll one range into the middle of its scrollport.
     * @param range - the match to reveal.
     * @returns whether the range has a measurable box.
     */
    function scrollRangeIntoView(range) {
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return false
      const node = range.startContainer
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      const scroller = element === null ? undefined : scrollportOf(element)
      if (scroller !== undefined) {
        const box = scroller.getBoundingClientRect()
        scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2
      } else {
        window.scrollBy(0, rect.top - window.innerHeight / 2)
      }
      return true
    }

    /**
     * Collect the text nodes a find bar searches: everything inside the root
     * except controls and inert nodes.
     * @param root - the searchable element.
     * @returns text nodes in document order.
     */
    function searchableTextNodes(root) {
      const nodes = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeValue === null || node.nodeValue === '') return NodeFilter.FILTER_REJECT
          const parent = node.parentElement
          if (parent === null) return NodeFilter.FILTER_REJECT
          if (parent.closest('button, input, textarea, select, script, style') !== null) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let node = walker.nextNode()
      while (node !== null) {
        nodes.push(node)
        node = walker.nextNode()
      }
      return nodes
    }

    /**
     * Build one range over `length` characters starting at `offset` inside an
     * element's rendered text.
     * @param textEl - element whose text nodes hold the line.
     * @param offset - character offset inside its text content.
     * @param length - how many characters to cover.
     * @returns the range, or undefined when the text is shorter.
     */
    function rangeAt(textEl, offset, length) {
      const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT)
      let seen = 0
      let node = walker.nextNode()
      while (node !== null) {
        const value = typeof node.nodeValue === 'string' ? node.nodeValue : ''
        if (offset + length <= seen + value.length) {
          const from = Math.max(0, offset - seen)
          const to = Math.min(value.length, from + length)
          if (from >= to) return undefined
          const range = document.createRange()
          range.setStart(node, from)
          range.setEnd(node, to)
          return range
        }
        seen += value.length
        node = walker.nextNode()
      }
      return undefined
    }

    /** Elements whose boundaries separate searchable text. */
    const BLOCK_SELECTOR =
      'p, div, li, tr, pre, h1, h2, h3, h4, h5, h6, blockquote, section, article, table, ul, ol, dl, dt, dd, figure, figcaption, aside, header, footer, main, nav, details, summary'

    /**
     * The nearest block ancestor of one text node's parent inside the search
     * root; nodes that share it may be matched as one run of text.
     * @param element - the text node's parent.
     * @param root - the search root.
     * @param cache - memo for this search.
     * @returns the block element.
     */
    function blockOf(element, root, cache) {
      if (element === null) return root
      if (cache.has(element)) return cache.get(element)
      const found = element.closest(BLOCK_SELECTOR)
      const block = found !== null && found !== root && root.contains(found) ? found : root
      cache.set(element, block)
      return block
    }

    /**
     * Flatten a search root into the text a regex sees: text nodes of one block
     * concatenate, and a newline separates blocks so a pattern cannot jump
     * between paragraphs.
     * @param body - the searchable element.
     * @returns the text and its per-node offset table.
     */
    function flattenText(body) {
      const nodes = searchableTextNodes(body)
      const cache = new Map()
      let text = ''
      const spans = []
      let previous
      for (const node of nodes) {
        const block = blockOf(node.parentElement, body, cache)
        if (previous !== undefined && block !== previous && !text.endsWith('\n')) text += '\n'
        const start = text.length
        text += typeof node.nodeValue === 'string' ? node.nodeValue : ''
        spans.push({ node, start, end: text.length })
        previous = block
      }
      return { text, spans }
    }

    /**
     * Turn one absolute match in the flattened text into a DOM range that may
     * span several text nodes.
     * @param spans - the offset table from flattenText.
     * @param at - match start.
     * @param length - match length.
     * @returns the range, or undefined for an unmappable hit.
     */
    function rangeAcross(spans, at, length) {
      const end = at + length
      let first
      let last
      for (const span of spans) {
        if (span.end <= at) continue
        if (first === undefined) first = span
        if (span.start >= end) break
        last = span
      }
      if (first === undefined || last === undefined) return undefined
      const startOffset = Math.max(0, Math.min(first.end - first.start, at - first.start))
      const endOffset = Math.max(0, Math.min(last.end - last.start, end - last.start))
      if (first === last && startOffset >= endOffset) return undefined
      const range = document.createRange()
      range.setStart(first.node, startOffset)
      range.setEnd(last.node, endOffset)
      return range
    }

    /**
     * Every match of one matcher across a search root, matched against the
     * flattened text so a pattern can cross syntax spans inside one block.
     * @param body - the searchable element.
     * @param matcher - the compiled matcher.
     * @returns ranges, capped at MAX_MATCHES.
     */
    function bodyRanges(body, matcher) {
      const flattened = flattenText(body)
      const ranges = []
      for (const hit of matcher.matches(flattened.text)) {
        const range = rangeAcross(flattened.spans, hit.at, hit.length)
        if (range !== undefined) ranges.push(range)
        if (ranges.length >= MAX_MATCHES) break
      }
      return ranges
    }

    /**
     * The text of one diff row: the line number and sign precede the text cell.
     * @param row - one `[data-diff-line]` element.
     * @returns the searchable text of that row.
     */
    function rowTextOf(row) {
      const text = row.lastElementChild
      if (text === null) return ''
      return typeof text.textContent === 'string' ? text.textContent : ''
    }

    /**
     * The logical rows of the visible diff: one per row even in split view,
     * where the new side wins and deletions fall back to the old side.
     * @param rootEl - the review tab root.
     * @returns rows in reading order.
     */
    function diffRows(rootEl) {
      const body = rootEl.querySelector('[data-review-view]')
      if (body === null) return []
      if (body.getAttribute('data-review-view') !== 'split') return Array.from(body.querySelectorAll('[data-diff-line]'))
      const left = body.querySelector('[data-diff-side="left"]')
      const right = body.querySelector('[data-diff-side="right"]')
      const leftRows = left === null ? [] : Array.from(left.querySelectorAll('[data-diff-line]'))
      const rightRows = right === null ? [] : Array.from(right.querySelectorAll('[data-diff-line]'))
      const rows = []
      const count = Math.max(leftRows.length, rightRows.length)
      for (let index = 0; index < count; index += 1) {
        const rightRow = rightRows[index]
        const leftRow = leftRows[index]
        if (rightRow !== undefined && rowTextOf(rightRow) !== '') rows.push(rightRow)
        else if (leftRow !== undefined) rows.push(leftRow)
      }
      return rows
    }

    /**
     * Every match of one query across the visible diff, line by line.
     * @param rootEl - the review tab root.
     * @param query - the typed query.
     * @param caseSensitive - whether to fold case.
     * @returns ranges in reading order, capped at MAX_MATCHES.
     */
    function reviewRanges(rootEl, matcher) {
      const ranges = []
      for (const row of diffRows(rootEl)) {
        const textEl = row.lastElementChild
        if (textEl === null) continue
        const text = rowTextOf(row)
        if (text === '') continue
        for (const hit of matcher.matches(text)) {
          const range = rangeAt(textEl, hit.at, hit.length)
          if (range !== undefined) ranges.push(range)
          if (ranges.length >= MAX_MATCHES) return ranges
        }
      }
      return ranges
    }

    const svg = (paths) =>
      h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true }, ...paths)

    const SEARCH_ICON = h(
      'svg',
      { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true },
      h('circle', { cx: 6.8, cy: 6.8, r: 4.3 }),
      h('path', { d: 'M10 10l3.6 3.6' }),
    )
    const PREV_ICON = svg([h('path', { key: 'p', d: 'M4 10l4-4 4 4' })])
    const NEXT_ICON = svg([h('path', { key: 'p', d: 'M4 6l4 4 4-4' })])
    const CLOSE_ICON = svg([h('path', { key: 'a', d: 'M4 4l8 8' }), h('path', { key: 'b', d: 'M12 4l-8 8' })])

    /**
     * The find bar itself: query input, match counter, case toggle, next and
     * previous, close. Toolbar buttons keep focus in the input.
     * @param props - controlled input state and the actions.
     */
    function FindBar(props) {
      const {
        inputRef,
        query,
        onQuery,
        caseSensitive,
        onToggleCase,
        wholeWord,
        onToggleWholeWord,
        regexMode,
        onToggleRegex,
        invalid,
        invalidTitle,
        count,
        hasMatches,
        onPrev,
        onNext,
        onClose,
        placeholder,
        style,
      } = props
      return h(
        'div',
        {
          className: 'dsh-search-in-file-panel',
          'data-dsh-search-in-file-panel': true,
          style,
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onPrev()
              else onNext()
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
          },
        },
        h(
          'div',
          { className: 'dsh-search-in-file-row' },
          h('input', {
            ref: inputRef,
            className: 'dsh-search-in-file-input',
            'data-dsh-search-in-file-input': true,
            type: 'text',
            value: query,
            placeholder,
            spellCheck: false,
            'aria-label': placeholder,
            'data-invalid': invalid === true ? 'true' : undefined,
            'aria-invalid': invalid === true,
            title: invalid === true ? invalidTitle : undefined,
            onChange: (event) => onQuery(event.target.value),
          }),
          h('span', { className: 'dsh-search-in-file-count', 'data-dsh-search-in-file-count': true }, query === '' ? '0/0' : count),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-search-in-file-tool',
              title: '区分大小写',
              'aria-label': '区分大小写',
              'aria-pressed': caseSensitive,
              onMouseDown: (event) => event.preventDefault(),
              onClick: onToggleCase,
            },
            h('span', { style: { fontSize: '11px', fontWeight: 600 } }, 'Aa'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-search-in-file-tool',
              title: '全词匹配',
              'aria-label': '全词匹配',
              'aria-pressed': wholeWord,
              onMouseDown: (event) => event.preventDefault(),
              onClick: onToggleWholeWord,
            },
            h('span', { style: { fontSize: '11px', fontWeight: 600 } }, 'W'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-search-in-file-tool',
              title: '正则表达式',
              'aria-label': '正则表达式',
              'aria-pressed': regexMode,
              onMouseDown: (event) => event.preventDefault(),
              onClick: onToggleRegex,
            },
            h('span', { style: { fontSize: '10px', fontWeight: 600 } }, '.*'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-search-in-file-tool',
              title: '上一个匹配 (Shift+Enter)',
              'aria-label': '上一个匹配',
              disabled: hasMatches !== true,
              onMouseDown: (event) => event.preventDefault(),
              onClick: onPrev,
            },
            PREV_ICON,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-search-in-file-tool',
              title: '下一个匹配 (Enter)',
              'aria-label': '下一个匹配',
              disabled: hasMatches !== true,
              onMouseDown: (event) => event.preventDefault(),
              onClick: onNext,
            },
            NEXT_ICON,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-search-in-file-tool',
              title: '关闭 (Esc)',
              'aria-label': '关闭查找',
              onMouseDown: (event) => event.preventDefault(),
              onClick: onClose,
            },
            CLOSE_ICON,
          ),
        ),
      )
    }

    /**
     * Find bar for one document preview. Searches the rendered body, so it
     * reaches exactly what the preview has loaded — the same surface a reader
     * sees. Matches are painted, never listed, so they cannot hide the text.
     * @param props - slot runtime props: the tab hook.
     * @returns the toggle button plus the open bar.
     */
    function PreviewFind(props) {
      const { useTabInfo } = props
      const { tab } = useTabInfo()
      const buttonRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const regionRef = React.useRef('other')
      const openRef = React.useRef(false)
      const rangesRef = React.useRef([])
      const currentRef = React.useRef(0)

      const [open, setOpen] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [options, updateOptions] = useFindOptions()
      const [error, setError] = React.useState('')
      const [ranges, setRanges] = React.useState([])
      const [current, setCurrent] = React.useState(0)
      const [geometry, setGeometry] = React.useState(undefined)

      openRef.current = open
      rangesRef.current = ranges
      currentRef.current = current

      const bodyOf = () => {
        const node = buttonRef.current
        if (node === null) return null
        const root = node.closest('[data-document-preview]')
        return root === null ? null : root.querySelector('[data-textpreview-body]')
      }

      const run = React.useCallback((value, switches, keepIndex) => {
        const matcher = createMatcher(value, switches)
        if (matcher.error !== undefined) {
          setError(matcher.error)
          setRanges([])
          setCurrent(0)
          clearPaint('preview')
          return []
        }
        setError('')
        const body = bodyOf()
        const found = body === null ? [] : bodyRanges(body, matcher)
        const next = keepIndex && found.length > 0 ? Math.min(currentRef.current, found.length - 1) : 0
        setRanges(found)
        setCurrent(next)
        paint('preview', found, next)
        return found
      }, [])

      // Search after a pause in typing; reveal the first match.
      React.useEffect(() => {
        if (!open || query === '') {
          clearPaint('preview')
          setRanges([])
          setCurrent(0)
          return undefined
        }
        const timer = setTimeout(() => {
          const found = run(query, options, false)
          if (found.length > 0) scrollRangeIntoView(found[0])
        }, 120)
        return () => clearTimeout(timer)
      }, [open, query, options, run])

      // Loaded pages and reloads change the body under the results.
      React.useEffect(() => {
        if (!open || query === '') return undefined
        const body = bodyOf()
        if (body === null) return undefined
        let timer
        const observer = new MutationObserver(() => {
          clearTimeout(timer)
          timer = setTimeout(() => run(query, options, true), 220)
        })
        observer.observe(body, { childList: true, subtree: true, characterData: true })
        return () => {
          clearTimeout(timer)
          observer.disconnect()
        }
      }, [open, query, options, run])

      // Place the bar exactly under the preview's 38px toolbar.
      React.useEffect(() => {
        if (!open) {
          setGeometry(undefined)
          return undefined
        }
        const update = () => {
          const root = buttonRef.current === null ? null : buttonRef.current.closest('[data-document-preview]')
          if (root === null) return
          const rect = root.getBoundingClientRect()
          if (rect.width < 40 || rect.height < 20) {
            setGeometry(undefined)
            return
          }
          setGeometry({ top: rect.top + HEADER_HEIGHT, left: rect.left, width: rect.width })
        }
        update()
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
        if (observer !== undefined) observer.observe(document.body)
        window.addEventListener('resize', update)
        return () => {
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', update)
        }
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
        return () => clearTimeout(timer)
      }, [open])

      // Ctrl/Cmd+F searches the file the pointer last touched; elsewhere the browser keeps it.
      React.useEffect(() => {
        if (!tab.visible) return undefined
        const onPointerDown = (event) => {
          const root = buttonRef.current === null ? null : buttonRef.current.closest('[data-document-preview]')
          regionRef.current = root !== null && root.contains(event.target) ? 'preview' : 'other'
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && openRef.current) {
            event.stopPropagation()
            setOpen(false)
            return
          }
          if (!(event.key === 'f' || event.key === 'F') || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
          const node = event.target
          const editable =
            node instanceof Element && node.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
          if (editable && node.closest('.dsh-search-in-file-panel') === null) return
          if (!openRef.current && regionRef.current !== 'preview') return
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
          setTimeout(() => inputRef.current?.select(), 0)
        }
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [tab.visible])

      React.useEffect(() => () => clearPaint('preview'), [])

      const jumpTo = React.useCallback((index) => {
        const list = rangesRef.current
        if (list.length === 0) return
        const next = ((index % list.length) + list.length) % list.length
        setCurrent(next)
        paint('preview', list, next)
        scrollRangeIntoView(list[next])
      }, [])

      const bar =
        open && tab.visible && geometry !== undefined
          ? createPortal(
              h(FindBar, {
                inputRef,
                query,
                onQuery: setQuery,
                caseSensitive: options.caseSensitive,
                onToggleCase: () => updateOptions({ caseSensitive: !options.caseSensitive }),
                wholeWord: options.wholeWord,
                onToggleWholeWord: () => updateOptions({ wholeWord: !options.wholeWord }),
                regexMode: options.regex,
                onToggleRegex: () => updateOptions({ regex: !options.regex }),
                invalid: error !== '',
                invalidTitle: error,
                count: ranges.length === 0 ? '0/0' : `${current + 1}/${ranges.length}`,
                hasMatches: ranges.length > 0,
                onPrev: () => jumpTo(current - 1),
                onNext: () => jumpTo(current + 1),
                onClose: () => setOpen(false),
                placeholder: '在文件中查找',
                style: { top: `${geometry.top}px`, left: `${geometry.left}px`, width: `${geometry.width}px` },
              }),
              document.body,
            )
          : null

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: 'dsh-search-in-file-toggle',
            'data-dsh-search-in-file-toggle': true,
            title: '在文件中查找 (Ctrl+F)',
            'aria-label': '在文件中查找',
            'aria-pressed': open,
            onClick: () => setOpen((value) => !value),
          },
          SEARCH_ICON,
        ),
        bar,
      )
    }

    /**
     * Find bar for one changes-review diff. The review tab exposes no toolbar
     * slot, so a host element is appended to its tools row and this component
     * renders there; the bar itself portals to the document body.
     * @param props - the reviewed tab's root element.
     * @returns the toolbar button and the open bar.
     */
    function ReviewFind({ reviewRoot }) {
      const inputRef = React.useRef(null)
      const regionRef = React.useRef('other')
      const openRef = React.useRef(false)
      const rangesRef = React.useRef([])
      const currentRef = React.useRef(0)

      const [open, setOpen] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [options, updateOptions] = useFindOptions()
      const [error, setError] = React.useState('')
      const [ranges, setRanges] = React.useState([])
      const [current, setCurrent] = React.useState(0)
      const [geometry, setGeometry] = React.useState(undefined)

      openRef.current = open
      rangesRef.current = ranges
      currentRef.current = current

      const visible = () => {
        if (!reviewRoot.isConnected) return false
        const rect = reviewRoot.getBoundingClientRect()
        return rect.width > 40 && rect.height > 20
      }

      const run = React.useCallback(
        (value, switches, keepIndex) => {
          const matcher = createMatcher(value, switches)
          if (matcher.error !== undefined) {
            setError(matcher.error)
            setRanges([])
            setCurrent(0)
            clearPaint('review')
            return []
          }
          setError('')
          const found = reviewRanges(reviewRoot, matcher)
          const next = keepIndex && found.length > 0 ? Math.min(currentRef.current, found.length - 1) : 0
          setRanges(found)
          setCurrent(next)
          paint('review', found, next)
          return found
        },
        [reviewRoot],
      )

      React.useEffect(() => {
        if (!open || query === '') {
          clearPaint('review')
          setRanges([])
          setCurrent(0)
          return undefined
        }
        const timer = setTimeout(() => {
          const found = run(query, options, false)
          if (found.length > 0) scrollRangeIntoView(found[0])
        }, 120)
        return () => clearTimeout(timer)
      }, [open, query, options, run])

      // A switched file or a re-rendered diff changes the rows under the results.
      React.useEffect(() => {
        if (!open || query === '') return undefined
        let timer
        const observer = new MutationObserver(() => {
          clearTimeout(timer)
          timer = setTimeout(() => run(query, options, true), 220)
        })
        observer.observe(reviewRoot, { childList: true, subtree: true, characterData: true })
        return () => {
          clearTimeout(timer)
          observer.disconnect()
        }
      }, [open, query, options, run, reviewRoot])

      React.useEffect(() => {
        if (!open) {
          setGeometry(undefined)
          return undefined
        }
        const update = () => {
          if (!visible()) {
            setGeometry(undefined)
            return
          }
          const rect = reviewRoot.getBoundingClientRect()
          setGeometry({ top: rect.top + HEADER_HEIGHT, left: rect.left, width: rect.width })
        }
        update()
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
        if (observer !== undefined) observer.observe(reviewRoot)
        window.addEventListener('resize', update)
        return () => {
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', update)
        }
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
        return () => clearTimeout(timer)
      }, [open])

      React.useEffect(() => {
        const onPointerDown = (event) => {
          regionRef.current = reviewRoot.contains(event.target) ? 'review' : 'other'
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && openRef.current) {
            event.stopPropagation()
            setOpen(false)
            return
          }
          if (!(event.key === 'f' || event.key === 'F') || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
          if (!visible()) return
          const node = event.target
          const editable =
            node instanceof Element && node.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
          if (editable && node.closest('.dsh-search-in-file-panel') === null) return
          if (!openRef.current && regionRef.current !== 'review') return
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
          setTimeout(() => inputRef.current?.select(), 0)
        }
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [reviewRoot])

      React.useEffect(() => () => clearPaint('review'), [])

      const jumpTo = React.useCallback((index) => {
        const list = rangesRef.current
        if (list.length === 0) return
        const next = ((index % list.length) + list.length) % list.length
        setCurrent(next)
        paint('review', list, next)
        scrollRangeIntoView(list[next])
      }, [])

      const bar =
        open && geometry !== undefined
          ? createPortal(
              h(FindBar, {
                inputRef,
                query,
                onQuery: setQuery,
                caseSensitive: options.caseSensitive,
                onToggleCase: () => updateOptions({ caseSensitive: !options.caseSensitive }),
                wholeWord: options.wholeWord,
                onToggleWholeWord: () => updateOptions({ wholeWord: !options.wholeWord }),
                regexMode: options.regex,
                onToggleRegex: () => updateOptions({ regex: !options.regex }),
                invalid: error !== '',
                invalidTitle: error,
                count: ranges.length === 0 ? '0/0' : `${current + 1}/${ranges.length}`,
                hasMatches: ranges.length > 0,
                onPrev: () => jumpTo(current - 1),
                onNext: () => jumpTo(current + 1),
                onClose: () => setOpen(false),
                placeholder: '在改动中查找',
                style: { top: `${geometry.top}px`, left: `${geometry.left}px`, width: `${geometry.width}px` },
              }),
              document.body,
            )
          : null

      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-search-in-file-toggle',
            'data-dsh-search-in-file-toggle': true,
            'data-dsh-search-in-file-surface': 'review',
            title: '在改动中查找 (Ctrl+F)',
            'aria-label': '在改动中查找',
            'aria-pressed': open,
            onClick: () => setOpen((value) => !value),
          },
          SEARCH_ICON,
        ),
        bar,
      )
    }

    /**
     * Mount one ReviewFind into every live changes-review toolbar. The review
     * tab owns its DOM, so the host is re-appended when React drops it and is
     * unmounted with the tab element.
     * @returns disposer that unmounts every host.
     */
    function mountReviewFinders() {
      const mounted = new Map()
      const scan = () => {
        for (const [rootEl, record] of mounted) {
          if (rootEl.isConnected) {
            if (!record.host.isConnected) {
              const tools = rootEl.querySelector(REVIEW_TOOL)
              if (tools !== null && tools.parentElement !== null) tools.parentElement.appendChild(record.host)
            }
            continue
          }
          try {
            record.reactRoot.unmount()
          } catch {
            // The host may already be gone with its container.
          }
          record.host.remove()
          mounted.delete(rootEl)
        }
        for (const rootEl of document.querySelectorAll(REVIEW_ROOT)) {
          if (mounted.has(rootEl)) continue
          const tools = rootEl.querySelector(REVIEW_TOOL)
          if (tools === null || tools.parentElement === null) continue
          const host = document.createElement('span')
          host.className = 'dsh-search-in-file-review-host'
          host.setAttribute('data-dsh-search-in-file-host', 'review')
          tools.parentElement.appendChild(host)
          const reactRoot = createRoot(host)
          reactRoot.render(h(ReviewFind, { reviewRoot: rootEl }))
          mounted.set(rootEl, { host, reactRoot })
        }
      }
      scan()
      const timer = setInterval(scan, 800)
      return () => {
        clearInterval(timer)
        for (const [, record] of mounted) {
          try {
            record.reactRoot.unmount()
          } catch {
            // A tab that vanished with its container leaves nothing to release.
          }
          record.host.remove()
        }
        mounted.clear()
      }
    }

    const inject = ['slots']

    function apply(ctx) {
      ensureStyle()
      ctx.effect(() => mountReviewFinders(), 'dsh-search-in-file: changes-review find bars')
      ctx.effect(() => {
        const disposers = RENDERER_IDS.map((key) =>
          ctx.slots.inject('sidebar.right.tab.document.action', () =>
            ctx.slots.register({ name: 'sidebar.right.tab.document.action', key }, PreviewFind),
          ),
        )
        return () => {
          for (const dispose of disposers) {
            try {
              dispose?.()
            } catch {
              // The slot may already be gone with the plugin lifetime.
            }
          }
        }
      }, 'dsh-search-in-file: document toolbar actions')
    }

    return { inject, apply }
  },
})
