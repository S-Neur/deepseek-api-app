import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import { formatMessageDay } from '../../utils/format.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/** 首屏只渲染最近这么多条消息（约 6 轮），往前翻再逐批补 */
const INITIAL_VISIBLE = 12
const VISIBLE_STEP = 12
/** 滚动到距顶部多少像素时自动补一批更早的消息 */
const LOAD_OLDER_THRESHOLD = 240

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const t = useTranslate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)

  // 长对话只渲染最近一批：窗口外的消息不进 DOM。
  // windowStart 为 null 时表示"跟着末尾走"（新消息到达时窗口自动前移）；用户上翻后固定起点。
  const [windowStart, setWindowStart] = useState<number | null>(null)
  useEffect(() => {
    setWindowStart(null)
  }, [session.id])
  const startIndex = Math.min(windowStart ?? Math.max(0, messages.length - INITIAL_VISIBLE), messages.length)
  const hiddenCount = startIndex
  const renderedMessages = hiddenCount > 0 ? messages.slice(startIndex) : messages
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null)

  const showOlder = useCallback(() => {
    const element = scrollRef.current
    if (!element || hiddenCount === 0) {
      return
    }
    // 补内容会把上方撑高，先记下高度，渲染后补回滚动偏移，视觉上不跳动
    preserveScrollRef.current = { height: element.scrollHeight, top: element.scrollTop }
    setWindowStart(Math.max(0, startIndex - VISIBLE_STEP))
  }, [hiddenCount, startIndex])

  useLayoutEffect(() => {
    const element = scrollRef.current
    const saved = preserveScrollRef.current
    if (!element || !saved) {
      return
    }
    preserveScrollRef.current = null
    element.scrollTop = saved.top + (element.scrollHeight - saved.height)
  }, [startIndex])

  // 滚到接近顶部时自动补更早的消息
  useEffect(() => {
    const element = scrollRef.current
    if (!element || hiddenCount === 0) {
      return
    }
    let armed = true
    const onScroll = () => {
      if (!armed) {
        return
      }
      if (element.scrollTop < LOAD_OLDER_THRESHOLD) {
        armed = false
        showOlder()
        // 留一帧给新内容渲染，避免同一次滚动里连续补两批
        setTimeout(() => {
          armed = true
        }, 300)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [hiddenCount, showOlder, isMobile])
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  // 轮次跳转：每一轮提问一行，点了滚到那条消息（不在窗口里就先加载）
  const [turnsOpen, setTurnsOpen] = useState(false)
  const [jumpNonce, setJumpNonce] = useState(0)
  const pendingJumpRef = useRef<string | null>(null)
  const turns = useMemo(
    () =>
      messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message.role === 'user'),
    [messages]
  )

  const jumpToTurn = (id: string, index: number) => {
    setTurnsOpen(false)
    if (index < startIndex) {
      setWindowStart(index)
    }
    pendingJumpRef.current = id
    // 目标可能已经渲染，此时窗口不变化；用 nonce 强制跑一次定位
    setJumpNonce((value) => value + 1)
  }

  useLayoutEffect(() => {
    const id = pendingJumpRef.current
    const scroller = scrollRef.current
    if (!id || !scroller) {
      return
    }
    const target = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
    if (!target) {
      return
    }
    pendingJumpRef.current = null
    stickyRef.current = false
    // 直接算 scrollTop 比 scrollIntoView 可靠：滚动容器是这里而不是文档
    const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset - 8), behavior: 'smooth' })
  }, [jumpNonce, startIndex, messages.length])

  // 右侧整条边缘当滚动条：拖动快速定位，长按叫出轮次面板
  const [scrubbing, setScrubbing] = useState(false)
  const edgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const edge = edgeRef.current
    const scroller = scrollRef.current
    if (!edge || !scroller) {
      return
    }
    let mode: 'idle' | 'pending' | 'drag' | 'menu' = 'idle'
    let timer = 0
    let startY = 0

    const scrub = (clientY: number) => {
      const rect = edge.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)))
      const max = scroller.scrollHeight - scroller.clientHeight
      stickyRef.current = false
      scroller.scrollTop = ratio * Math.max(0, max)
    }

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return
      }
      startY = event.touches[0].clientY
      mode = 'pending'
      timer = window.setTimeout(() => {
        if (mode === 'pending') {
          mode = 'menu'
          setTurnsOpen(true)
        }
      }, 380)
    }

    const onMove = (event: TouchEvent) => {
      if (mode !== 'pending' && mode !== 'drag') {
        return
      }
      const y = event.touches[0].clientY
      if (mode === 'pending') {
        if (Math.abs(y - startY) < 8) {
          return
        }
        window.clearTimeout(timer)
        mode = 'drag'
        setScrubbing(true)
      }
      event.preventDefault()
      scrub(y)
    }

    const onEnd = () => {
      window.clearTimeout(timer)
      if (mode === 'drag') {
        setScrubbing(false)
      }
      mode = 'idle'
    }

    edge.addEventListener('touchstart', onStart, { passive: true })
    edge.addEventListener('touchmove', onMove, { passive: false })
    edge.addEventListener('touchend', onEnd)
    edge.addEventListener('touchcancel', onEnd)
    return () => {
      window.clearTimeout(timer)
      edge.removeEventListener('touchstart', onStart)
      edge.removeEventListener('touchmove', onMove)
      edge.removeEventListener('touchend', onEnd)
      edge.removeEventListener('touchcancel', onEnd)
    }
  }, [isMobile, startIndex])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {hiddenCount > 0 ? (
              <button type="button" className={styles.earlier} onClick={showOlder}>
                {t('showEarlierMessages', { count: Math.min(hiddenCount, VISIBLE_STEP) })}
              </button>
            ) : null}
            {renderedMessages.map((message, index) => {
              const absoluteIndex = startIndex + index
              return message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={absoluteIndex === 0}
                  isLast={absoluteIndex === lastIndex || absoluteIndex === lastIndex - 1}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              ) : (
                <AssistantMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  isLast={absoluteIndex === lastIndex}
                  streaming={streaming && absoluteIndex === lastIndex}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              )
            })}
          </div>
        </div>
        {footer}
        {/* 右侧整条边缘：拖动快速定位，长按叫出轮次面板；不拖动时不画任何东西 */}
        <div ref={edgeRef} className={styles.edgeStrip} aria-hidden />
        {scrubbing ? <div className={styles.scrubThumb} /> : null}
        {turnsOpen ? (
          <>
            <div className={styles.turnMask} onClick={() => setTurnsOpen(false)} />
            <div className={styles.turnPanel} role="dialog" aria-label={t('turnListTitle')}>
              <div className={styles.turnPanelTitle}>{t('turnListTitle')}</div>
              <div className={styles.turnPanelList}>
                {turns.map(({ message, index }, turnIndex) => (
                  <button
                    key={message.id}
                    type="button"
                    className={styles.turnItem}
                    onClick={() => jumpToTurn(message.id, index)}
                  >
                    <span className={styles.turnItemIndex}>{turnIndex + 1}</span>
                    <span className={styles.turnItemText}>
                      {message.role === 'user' && message.content
                        ? message.content.slice(0, 40)
                        : t('untitledChat')}
                    </span>
                    <span className={styles.turnItemTime}>
                      {formatMessageDay(message.createdAt) ?? ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
