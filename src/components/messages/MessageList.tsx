import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
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
      </div>
    </ScrollToBottomContext.Provider>
  )
}
