/**
 * 浏览器半：右下角的下载进度卡片。
 *
 * 数据有两路：Host 的 `/plugin/dsh-transfer-dock/state` 给出「哪些后台任务是下载、
 * 已经写了多少字节、当前速度」；job 输出流给出下载器自己打的百分比（git、
 * aria2、curl -# 等）。两路合起来：有百分比就用百分比，没有就用字节曲线。
 *
 * @module dsh-transfer-dock/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-transfer-dock',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const STATE_PATH = '/plugin/dsh-transfer-dock/state'
    const POLL_MS = 600
    const FADE_MS = 2600
    const MIN_LIVE_MS = 500
    const MAX_TEXT = 16 * 1024

    // 卡片用 portal 直接挂到 document.body：插槽容器的 transform/overflow 会让
    // position: fixed 退化成相对祖先定位，甚至被裁剪。拿不到 react-dom 时回退。
    const ReactDOM = (() => {
      try {
        const loaded = require('react-dom')
        return loaded !== null && typeof loaded.createPortal === 'function' ? loaded : null
      } catch {
        return null
      }
    })()

    const EMPTY = { version: 1, now: 0, tasks: [] }
    const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const MESSAGES = {
      en: {
        collapse: 'Collapse download to a floating button',
        expand: 'Expand download',
        unknown: 'Progress unknown',
        downloading: 'Downloading…',
        fetching: 'Fetching repository…',
        stopping: 'Stopping…',
        completed: 'Completed',
        failed: 'Download failed',
        killed: 'Cancelled',
        written: 'Written:',
        remaining: 'Left:',
      },
      zh: {
        collapse: '收起为悬浮球',
        expand: '展开下载详情',
        unknown: '进度未知',
        downloading: '正在下载…',
        fetching: '正在获取仓库…',
        stopping: '正在停止…',
        completed: '已完成',
        failed: '下载失败',
        killed: '已取消',
        written: '已写入',
        remaining: '剩',
      },
    }

    /** 状态色与排版都走主题变量。 */
    const S = {
      wrap: {
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 2147483000,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        gap: 8,
        width: 378,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100dvh - 24px)',
        padding: 6,
        boxSizing: 'border-box',
        overflowY: 'auto',
        pointerEvents: 'none',
      },
      ball: {
        pointerEvents: 'auto',
        position: 'relative',
        flex: '0 0 auto',
        width: 48,
        height: 48,
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '50%',
        background: 'var(--dsw-alias-button-floating-fill)',
        boxShadow: '0 3px 12px color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 17,
        lineHeight: 1,
        fontWeight: 650,
        cursor: 'pointer',
      },
      ring: {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      },
      card: {
        flex: '0 0 100%',
        minWidth: 0,
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        borderRadius: 14,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-2) 94%, transparent)',
        boxShadow: '0 18px 40px -18px rgba(0, 0, 0, .55), 0 2px 8px -2px rgba(0, 0, 0, .25)',
        backdropFilter: 'blur(12px) saturate(140%)',
        padding: '11px 12px 12px',
        fontFamily: 'inherit',
      },
      head: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 },
      badge: {
        flex: 'none',
        width: 26,
        height: 26,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--dsw-alias-brand-text)',
        background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1))',
      },
      titles: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 },
      name: {
        fontSize: 13,
        fontWeight: 600,
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-primary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      sub: {
        fontSize: 11,
        lineHeight: '15px',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      close: {
        flex: 'none',
        width: 20,
        height: 20,
        padding: 0,
        border: 0,
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--dsw-alias-label-quaternary)',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: '18px',
      },
      track: {
        position: 'relative',
        height: 6,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'var(--dsw-alias-border-l1)',
      },
      fill: {
        height: '100%',
        borderRadius: 999,
        background: 'var(--dsw-alias-brand-primary)',
        transition: 'width 240ms ease-out',
      },
      fillDone: { background: 'var(--dsw-alias-state-success-primary)' },
      fillFailed: { background: 'var(--dsw-alias-state-error-primary)' },
      indeterminate: {
        height: '100%',
        width: '100%',
        backgroundImage:
          'repeating-linear-gradient(115deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 78%, transparent) 0 12px, color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent) 12px 24px)',
        backgroundSize: '24px 100%',
        animation: 'dsh-transfer-dock-stripes 900ms linear infinite',
      },
      meta: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        marginTop: 8,
        fontSize: 11,
        lineHeight: '15px',
        color: 'var(--dsw-alias-label-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
      metaRight: { color: 'var(--dsw-alias-label-tertiary)', flex: 'none' },
      detail: {
        marginTop: 6,
        fontSize: 11,
        lineHeight: '15px',
        color: 'var(--dsw-alias-state-error-primary)',
        wordBreak: 'break-word',
      },
      keyframes: [
        '@keyframes dsh-transfer-dock-in{from{opacity:0;transform:translateY(4px) scale(.96)}to{opacity:1;transform:none}}',
        '@keyframes dsh-transfer-dock-stripes{from{background-position:0 0}to{background-position:24px 0}}',
        '@keyframes dsh-transfer-dock-spin{to{transform:rotate(360deg)}}',
        '.dsh-transfer-dock-card,.dsh-transfer-dock-ball{animation:dsh-transfer-dock-in 150ms ease-out both}',
        '.dsh-transfer-dock-spin{animation:dsh-transfer-dock-spin 1.3s linear infinite}',
        '.dsh-transfer-dock-arc{transition:stroke-dashoffset 240ms ease-out}',
        '.dsh-transfer-dock-ball:hover{background:var(--dsw-alias-button-floating-hover)!important}',
        '.dsh-transfer-dock button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '@media (prefers-reduced-motion: reduce){.dsh-transfer-dock-card,.dsh-transfer-dock-ball,.dsh-transfer-dock-spin,.dsh-transfer-dock-stripes{animation:none!important}.dsh-transfer-dock-arc{transition:none}}',
      ].join(''),
    }

    /** 各下载器的进度行格式，按特异性从高到低匹配。 */
    const MATCHERS = [
      {
        // aria2c: [#1a2b3c 12MiB/45MiB(26%) CN:1 DL:1.2MiB ETA:30s]
        re: /\[#\w+\s+([\d.]+)\s*([KMGT]i?B)\/([\d.]+)\s*([KMGT]i?B)\((\d+)%\)(?:[^\]]*?DL:\s*([\d.]+)\s*([KMGT]i?B))?(?:[^\]]*?ETA:\s*(\S+))?/i,
        pick: match => ({
          downloaded: bytes(match[1], match[2]),
          total: bytes(match[3], match[4]),
          percent: Number(match[5]),
          speed: match[6] === undefined ? undefined : bytes(match[6], match[7]),
          eta: match[8],
        }),
      },
      {
        // git: Receiving objects: 45% (1234/2740), 1.20 MiB | 2.30 MiB/s
        // 只认真正走网络的那一段；Counting/Compressing/Resolving 是本地阶段，
        // 拿它们当百分比会让进度条在阶段之间来回跳。
        re: /Receiving objects:\s+(\d+)%\s*\((\d+)\/(\d+)\)(?:,\s*([\d.]+)\s*([KMGT]i?B))?(?:\s*\|\s*([\d.]+)\s*([KMGT]i?B)\/s)?/i,
        pick: match => ({
          percent: Number(match[1]),
          downloaded: match[4] === undefined ? undefined : bytes(match[4], match[5]),
          speed: match[6] === undefined ? undefined : bytes(match[6], match[7]),
        }),
      },
      {
        // docker pull: 45%|████   | 12.3MB/27MB
        re: /(\d+)%\|[^|]*\|\s*([\d.]+)\s*([KMGT]i?B)\/([\d.]+)\s*([KMGT]i?B)/i,
        pick: match => ({
          percent: Number(match[1]),
          downloaded: bytes(match[2], match[3]),
          total: bytes(match[4], match[5]),
        }),
      },
      {
        // pip 收尾行: 12.9/12.9 MB 491.0 kB/s eta 0:00:00
        re: /([\d.]+)\s*\/\s*([\d.]+)\s*([KMGT]?i?B)\s+([\d.]+)\s*([KMGT]?i?B)\/s(?:\s+eta\s+(\S+))?/i,
        pick: match => ({
          downloaded: bytes(match[1], match[3]),
          total: bytes(match[2], match[3]),
          speed: bytes(match[4], match[5]),
          eta: match[6],
        }),
      },
      {
        // wget（非 TTY）：0K .......... .......... 45% 1.2M 3s
        re: /(\d+)%\s+([\d.]+)\s*([KMGT])\s+([\d.]+s)$/i,
        pick: match => ({
          percent: Number(match[1]),
          speed: bytes(match[2], `${match[3]}B`),
          eta: match[4],
        }),
      },
      {
        // curl -# 的哈希进度条：###########  45.0%
        re: /#+\s*([\d.]+)\s*%/,
        pick: match => ({ percent: Number(match[1]) }),
      },
      {
        // 通用：拿一行里最后的百分比与速度
        re: /(\d{1,3}(?:\.\d)?)\s*%/,
        pick: match => ({ percent: Number(match[1]) }),
      },
    ]

    /** 独立的「X MB/s」速度提示。 */
    const SPEED_LINE_RE = /([\d.]+)\s*([KMGT]?i?B)\s*\/\s*s/i

    /**
     * `12.9` + `MB` → 字节数。
     * @param value - 数字文本。
     * @param unit - 单位文本。
     * @returns 字节数。
     */
    function bytes(value, unit) {
      const amount = Number.parseFloat(String(value).replace(/,/g, ''))
      if (!Number.isFinite(amount)) return undefined
      const normalized = String(unit ?? '').toLowerCase()
      const base = normalized.includes('i') ? 1024 : 1000
      if (normalized.startsWith('k')) return amount * base
      if (normalized.startsWith('m')) return amount * base ** 2
      if (normalized.startsWith('g')) return amount * base ** 3
      if (normalized.startsWith('t')) return amount * base ** 4
      return amount
    }

    /**
     * 人读的字节数。
     * @param value - 字节数。
     * @returns 形如 `1.4 MB`。
     */
    function formatBytes(value) {
      if (!Number.isFinite(value) || value <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let amount = value
      let index = 0
      while (amount >= 1000 && index < units.length - 1) {
        amount /= 1000
        index += 1
      }
      const digits = amount >= 100 || index === 0 ? 0 : amount >= 10 ? 1 : 2
      return `${amount.toFixed(digits)} ${units[index]}`
    }

    /**
     * 人读的时长。
     * @param ms - 毫秒。
     * @returns 形如 `12s`、`1m 20s`。
     */
    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '0s'
      const seconds = Math.round(ms / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
      const hours = Math.floor(minutes / 60)
      return `${hours}h ${minutes % 60}m`
    }

    /**
     * 把 `eta` 的多种写法统一成毫秒。
     * @param value - `30s`、`0:00:12`、`12s` 之类。
     * @returns 毫秒数。
     */
    function parseEta(value) {
      if (typeof value !== 'string' || value === '') return undefined
      const clock = value.match(/^(\d+):(\d{2}):(\d{2})$/)
      if (clock !== null) {
        return ((Number(clock[1]) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000
      }
      const simple = value.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i)
      if (simple === null) return undefined
      const amount = Number(simple[1])
      const unit = (simple[2] ?? 's').toLowerCase()
      return amount * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1_000)
    }

    /** git 在收完包之后的本地阶段，它们的百分比不是下载进度。 */
    const LOCAL_PHASE_RE = /^(?:remote:\s*)?(?:Resolving|Counting|Compressing|Writing|Updating|Enumerating)\b/i

    /**
     * 从任务输出的尾部解析进度字段。
     * @param text - job 的保留输出。
     * @returns 解析到的字段，全部可选。
     */
    function parseProgress(text) {
      if (typeof text !== 'string' || text === '') return {}
      const tail = text.length > MAX_TEXT ? text.slice(text.length - MAX_TEXT) : text
      // pip 会把总大小写在下载起始行里，后面的进度条只有已下载量。
      const totalHint = tail.match(/(?:Downloading|Download)[^\r\n]*?\(([\d.]+)\s*([KMGT]i?B)\)/i)
      const hintedTotal = totalHint === null ? undefined : bytes(totalHint[1], totalHint[2])
      const lines = tail.split(/[\r\n]+/).filter(line => line.trim() !== '')
      const start = Math.max(0, lines.length - 60)
      for (let index = lines.length - 1; index >= start; index -= 1) {
        const line = lines[index]
        const trimmed = line.trim()
        if (LOCAL_PHASE_RE.test(trimmed)) continue
        for (const matcher of MATCHERS) {
          const match = line.match(matcher.re)
          if (match === null) continue
          const picked = matcher.pick(match)
          const cleaned = {}
          if (Number.isFinite(picked.percent) && picked.percent >= 0 && picked.percent <= 100) {
            cleaned.percent = picked.percent
          }
          if (Number.isFinite(picked.downloaded)) cleaned.downloaded = picked.downloaded
          if (Number.isFinite(picked.total) && picked.total > 0) cleaned.total = picked.total
          if (Number.isFinite(picked.speed)) cleaned.speed = picked.speed
          const eta = parseEta(picked.eta)
          if (eta !== undefined) cleaned.eta = eta
          if (Object.keys(cleaned).length > 0) {
            if (cleaned.total === undefined && Number.isFinite(hintedTotal) && hintedTotal > 0) {
              cleaned.total = hintedTotal
            }
            if (cleaned.speed === undefined) {
              const speedMatch = line.match(SPEED_LINE_RE)
              if (speedMatch !== null) {
                const speed = bytes(speedMatch[1], speedMatch[2])
                if (Number.isFinite(speed)) cleaned.speed = speed
              }
            }
            return cleaned
          }
        }
      }
      // 还没有任何进度行时，总大小本身也是有用的信息：配合磁盘字节就能算百分比。
      if (Number.isFinite(hintedTotal) && hintedTotal > 0) return { total: hintedTotal }
      return {}
    }

    /**
     * 一个任务的展示模型。
     * @param task - Host 快照里的一条。
     * @param observedText - 该 job 的输出文本。
     * @param now - 当前时间。
     * @returns 渲染用的字段。
     */
    function present(task, observedText, now) {
      const parsed = parseProgress(observedText)
      const running = task.status === 'running' || task.status === 'stopping'
      const downloaded = Math.max(
        Number.isFinite(parsed.downloaded) ? parsed.downloaded : 0,
        Number.isFinite(task.bytes) ? task.bytes : 0,
      )
      const total =
        Number.isFinite(parsed.total) && parsed.total > 0
          ? parsed.total
          : Number.isFinite(task.total) && task.total > 0
            ? task.total
            : undefined
      let percent = Number.isFinite(parsed.percent) ? parsed.percent : undefined
      if (percent === undefined && total !== undefined) {
        percent = Math.min(100, (downloaded / total) * 100)
      }
      const speed = Number.isFinite(parsed.speed) && parsed.speed > 0 ? parsed.speed : task.speed
      let eta = parsed.eta
      if (eta === undefined && total !== undefined && downloaded > 0 && speed > 0 && downloaded < total) {
        eta = ((total - downloaded) / speed) * 1000
      }
      const elapsed = Math.max(
        0,
        (task.finishedAt === null || task.finishedAt === undefined ? now : task.finishedAt) -
          (task.startedAt ?? now),
      )
      return {
        running,
        downloaded,
        total,
        percent,
        speed: running ? speed : 0,
        eta: running ? eta : undefined,
        elapsed,
      }
    }

    /**
     * 标题下的一行说明。
     * @param task - 任务。
     * @param view - 展示模型。
     * @returns 短文本。
     */
    function subtitleOf(task, view, t) {
      if (['failed', 'killed', 'completed', 'stopping'].includes(task.status)) return t(task.status)
      if (view.total !== undefined) return `${formatBytes(view.downloaded)} / ${formatBytes(view.total)}`
      if (view.downloaded > 0) return `${t('written')} ${formatBytes(view.downloaded)}`
      return t(task.tool === 'git' ? 'fetching' : 'downloading')
    }

    function fileGlyph(fileName) {
      const name = typeof fileName === 'string' ? fileName.trim() : ''
      return GRAPHEMES.segment(name)[Symbol.iterator]().next().value?.segment ?? '↓'
    }

    function progressDisplay(task, view) {
      const failed = task.status === 'failed' || task.status === 'killed'
      const done = task.status === 'completed'
      const percent = done ? 100 : Number.isFinite(view.percent) ? Math.max(0, Math.min(100, view.percent)) : undefined
      return {
        done,
        failed,
        percent,
        // 刚起步时 0% 的环看不见；运行时给一段最小弧，读数仍是真实百分比。
        drawn: percent === undefined ? undefined : view.running ? Math.max(1.5, percent) : percent,
        spinning: view.running && percent === undefined,
        // 失败/取消且从没拿到百分比：这是「出错了」，不是「下载完了」。
        failedUnknown: failed && percent === undefined,
      }
    }

    /**
     * 右下角某一行卡片右侧的元信息。
     * @param task - 任务。
     * @param view - 展示模型。
     * @returns 短文本。
     */
    function metaOf(view, t) {
      if (!view.running) return formatDuration(view.elapsed)
      const parts = []
      if (view.speed > 0) parts.push(`${formatBytes(view.speed)}/s`)
      if (view.eta !== undefined && Number.isFinite(view.eta)) parts.push(`${t('remaining')} ${formatDuration(view.eta)}`)
      parts.push(formatDuration(view.elapsed))
      return parts.join(' · ')
    }

    /** 面板本体。 */
    function DownloadCards(props) {
      const jobs = props.jobs
      const [snapshot, setSnapshot] = React.useState(EMPTY)
      const [clock, setClock] = React.useState(() => Date.now())
      const { locale } = props
      const t = React.useMemo(() => locale.bind('dsh-transfer-dock.ui'), [locale])
      const subscribeLocale = React.useCallback(callback => locale.subscribe(callback), [locale])
      const getLocale = React.useCallback(() => locale.getSnapshot(), [locale])
      React.useSyncExternalStore(subscribeLocale, getLocale)

      // 轮询 Host 状态；页面隐藏时暂停，避免无意义开销。
      React.useEffect(() => {
        let stopped = false
        let timer
        const tick = async () => {
          if (!stopped && !document.hidden) {
            try {
              const response = await fetch(STATE_PATH, { cache: 'no-store' })
              if (response.ok) {
                const payload = await response.json()
                if (!stopped && payload !== null && typeof payload === 'object') {
                  setSnapshot({
                    version: payload.version ?? 1,
                    now: payload.now ?? Date.now(),
                    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
                  })
                }
              }
            } catch {
              // Host 未就绪或页面正在关闭：保持上一次状态。
            }
          }
          if (!stopped) timer = setTimeout(tick, POLL_MS)
        }
        tick()
        return () => {
          stopped = true
          if (timer !== undefined) clearTimeout(timer)
        }
      }, [])

      // 让耗时与 ETA 持续走动。
      React.useEffect(() => {
        const timer = setInterval(() => setClock(Date.now()), 500)
        return () => clearInterval(timer)
      }, [])

      // 收起只改变显示，不把任务从进度订阅中剔除。
      const tasks = snapshot.tasks

      // 对运行中的任务打开输出观测，失败或结束即释放。
      const watchKey = tasks
        .filter(task => task.running !== false && (task.status === 'running' || task.status === 'stopping'))
        .map(task => `${task.sessionId ?? ''}:${task.id}`)
        .join('|')
      React.useEffect(() => {
        if (jobs === undefined || jobs === null) return undefined
        const disposers = []
        for (const task of tasks) {
          if (task.sessionId === null || task.sessionId === undefined) continue
          if (task.status !== 'running' && task.status !== 'stopping') continue
          try {
            disposers.push(jobs.observe(task.sessionId, task.id))
          } catch {
            // 会话已释放或无权限：卡片照常显示字节曲线。
          }
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // 忽略重复释放。
            }
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [watchKey, jobs])

      const subscribe = React.useCallback(
        callback => {
          if (jobs === undefined || jobs === null || jobs.state === undefined) return () => {}
          return jobs.state.subscribe(callback)
        },
        [jobs],
      )
      const getSnapshot = React.useCallback(() => {
        if (jobs === undefined || jobs === null || jobs.state === undefined) return EMPTY_OBSERVED
        return jobs.state.getSnapshot()
      }, [jobs])
      const observed = React.useSyncExternalStore(subscribe, getSnapshot)

      const cards = []
      for (const task of tasks) {
        const view = present(task, observedTextOf(observed, task.id), clock)
        const finished = !view.running
        // 太短的任务不闪一下；结束的任务留一小段淡出时间。
        if (!finished && view.elapsed < MIN_LIVE_MS) continue
        const settledAt = task.finishedAt
        const expired =
          finished && settledAt !== null && settledAt !== undefined && clock - settledAt > FADE_MS
        // 过期由卡片自己处理：聚焦中的卡片留到失焦，别把键盘焦点丢给 body。
        cards.push(h(DownloadTile, { key: String(task.id), task, view, t, expired }))
      }
      if (cards.length === 0) return null
      // 挂到 body：插槽容器上的 transform / overflow 会让 position: fixed 失效或被裁剪。
      const panel = h('div', { style: S.wrap, className: 'dsh-transfer-dock' }, h('style', null, S.keyframes), cards)
      if (ReactDOM !== null) return ReactDOM.createPortal(panel, document.body)
      return panel
    }

    /** 键盘焦点（:focus-visible）是否还停在这一项里。 */
    function holdsKeyboardFocus(node) {
      if (node === null || typeof document === 'undefined') return false
      const active = document.activeElement
      if (active === null || active === undefined || !node.contains(active)) return false
      try {
        return typeof active.matches === 'function' ? active.matches(':focus-visible') : true
      } catch {
        return true
      }
    }

    /** 同一个任务在卡片与球之间切换，保留订阅和键盘焦点。 */
    function DownloadTile({ task, view, t, expired }) {
      const [collapsed, setCollapsed] = React.useState(false)
      const [, setFocusTick] = React.useState(0)
      const nextFocus = React.useRef(false)
      const control = React.useRef(null)
      const root = React.useRef(null)
      React.useLayoutEffect(() => {
        if (nextFocus.current) {
          nextFocus.current = false
          control.current?.focus({ preventScroll: true })
        }
      }, [collapsed])
      const toggle = () => {
        nextFocus.current = true
        setCollapsed(value => !value)
      }
      const focusProps = {
        onFocus: () => setFocusTick(value => value + 1),
        onBlur: event => {
          // 卡片与球互换时控件会被替换，那一次失焦不算「人走开了」。
          const next = event.relatedTarget
          if (next !== null && typeof next === 'object' && event.currentTarget.contains(next)) return
          setFocusTick(value => value + 1)
        },
      }
      const progress = progressDisplay(task, view)
      const glyph = fileGlyph(task.fileName)
      const shared = { rootRef: root, task, view, t, progress, glyph, control, toggle, focusProps }
      // 结束的卡片到时间就该消失；但键盘用户还停在这一项上时，留到失焦为止。
      if (expired && !holdsKeyboardFocus(root.current)) return null
      return collapsed ? h(ProgressBall, shared) : h(Card, shared)
    }

    function ProgressBall({ task, view, t, progress, glyph, control, toggle, focusProps, rootRef }) {
      const { done, failed, percent, drawn, spinning, failedUnknown } = progress
      const fileName = task.fileName || task.tool
      const status = !view.running || task.status === 'stopping' ? subtitleOf(task, view, t) : ''
      const amount = percent !== undefined ? `${Math.round(percent)}%` : spinning ? t('unknown') : ''
      const info = [status, amount].filter(Boolean).join(' · ')
      const label = `${t('expand')}: ${fileName}${info ? ` (${info})` : ''}`
      const stroke = done
        ? 'var(--dsw-alias-state-success-primary)'
        : failed
          ? 'var(--dsw-alias-state-error-primary)'
          : 'var(--dsw-alias-brand-primary)'
      const circle = { cx: 24, cy: 24, r: 19.5, fill: 'none', strokeWidth: 3, pathLength: 100 }
      const centered = { transform: 'rotate(-90 24 24)' }
      let arc = null
      if (spinning) {
        // 不知道百分比：转圈，不假装有进度。
        arc = h(
          'g',
          { className: 'dsh-transfer-dock-spin', style: { transformOrigin: '24px 24px' } },
          h('circle', { ...circle, ...centered, stroke, strokeLinecap: 'round', strokeDasharray: '24 76' }),
        )
      } else if (failedUnknown) {
        // 失败且从未拿到百分比：虚线环说明「有问题」，不用满环冒充 100%。
        arc = h('circle', { ...circle, ...centered, stroke, strokeDasharray: '5 7' })
      } else if (drawn !== undefined) {
        arc = h('circle', {
          ...circle,
          ...centered,
          stroke,
          strokeLinecap: 'round',
          className: 'dsh-transfer-dock-arc',
          strokeDasharray: '100 100',
          strokeDashoffset: 100 - drawn,
        })
      }
      return h('button', {
        ...focusProps,
        type: 'button',
        // 收起时这一项本身就是按钮：根节点与焦点控件是同一个元素。
        ref: node => {
          rootRef.current = node
          control.current = node
        },
        onClick: toggle, style: S.ball, className: 'dsh-transfer-dock-ball',
        title: label, 'aria-label': label, 'aria-expanded': false,
      },
      h('svg', { viewBox: '0 0 48 48', style: S.ring, 'aria-hidden': true, focusable: 'false' },
        h('circle', {
          ...circle,
          stroke: failedUnknown
            ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)'
            : 'var(--dsw-alias-border-l2)',
        }),
        arc,
      ),
      h('span', { 'aria-hidden': true }, glyph),
      )
    }

    function Card({ task, view, t, progress, glyph, control, toggle, focusProps, rootRef }) {
      const { done, failed, percent, drawn, spinning } = progress
      const fillStyle = { ...S.fill }
      if (done) Object.assign(fillStyle, S.fillDone)
      if (failed) Object.assign(fillStyle, S.fillFailed)

      // 失败但没有百分比时不画满条：没有测量值可画，状态由副标题与错误行说明。
      const bar = h('div', { style: S.track, 'aria-hidden': true },
        spinning
          ? h('div', { style: S.indeterminate, className: 'dsh-transfer-dock-stripes' })
          : drawn === undefined
            ? null
            : h('div', { style: { ...fillStyle, width: `${drawn}%` } }),
      )

      const meta = metaOf(view, t)
      const percentLabel = percent !== undefined ? `${Math.round(percent)}%` : ''

      return h(
        'div',
        { ...focusProps, ref: rootRef, style: S.card, className: 'dsh-transfer-dock-card' },
        h(
          'div',
          { style: S.head },
          h('div', { style: S.badge, 'aria-hidden': true }, glyph),
          h(
            'div',
            { style: S.titles },
            h('div', { style: S.name, title: task.label }, task.fileName || task.tool),
            h('div', { style: S.sub }, subtitleOf(task, view, t)),
          ),
          h(
            'button',
            {
              type: 'button',
              style: S.close,
              ref: control,
              title: t('collapse'),
              'aria-label': `${t('collapse')}: ${task.fileName || task.tool}`,
              'aria-expanded': true,
              onClick: toggle,
            },
            '✕',
          ),
        ),
        bar,
        h(
          'div',
          { style: S.meta },
          h('span', null, percentLabel === '' ? task.tool : `${percentLabel} · ${task.tool}`),
          h('span', { style: S.metaRight }, meta),
        ),
        failed && typeof task.detail === 'string' && task.detail !== ''
          ? h('div', { style: S.detail }, task.detail)
          : null,
      )
    }

    const EMPTY_OBSERVED = { rows: {}, observed: {} }

    /**
     * 从 jobs 客户端状态里取出某个任务的输出文本。
     * @param observed - `state.observed`。
     * @param id - job id。
     * @returns 输出文本。
     */
    function observedTextOf(observed, id) {
      if (observed === null || observed === undefined) return ''
      const view = observed.observed?.[String(id)]
      return view !== undefined && typeof view.text === 'string' ? view.text : ''
    }

    return {
      inject: ['slots', 'jobs', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('dsh-transfer-dock.ui', MESSAGES))
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-transfer-dock',
              order: 60,
              inject: () => ({ jobs: ctx.jobs, locale: ctx.locale }),
            },
            DownloadCards,
          ),
        )
      },
    }
  },
})
