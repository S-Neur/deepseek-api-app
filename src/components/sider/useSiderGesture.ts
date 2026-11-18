import { useEffect, useRef, type RefObject } from 'react'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'
import styles from './Sider.module.css'

/** 判定为横向手势之前允许的抖动 */
const SLOP = 12
/** 松手时按速度直接定论的阈值（px/ms） */
const FLING = 0.3
/** 松手时按位移定论的比例 */
const RATIO = 0.25

/**
 * 触摸起点是否落在可以横向滚动的区域里（代码块、宽表格）。
 * 这类区域优先保留给内容自己，避免右划翻代码时把抽屉带出来。
 */
const insideHorizontalScroller = (target: EventTarget | null) => {
  for (let element = target instanceof Element ? target : null; element && element !== document.body; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 4) {
      return true
    }
  }
  return false
}

/**
 * 移动端抽屉的滑动手势：
 * - 抽屉关着时，**在页面任意位置右划**都能把它拉出来（跟官方 App 一致），跟手滑动
 * - 抽屉开着时，向左划收起
 * - 松手按位移或速度决定归位，用 CSS transition 补完剩下的动画
 *
 * 位移直接写行内样式（不经过 React 状态），避免每帧重渲染。
 */
export const useSiderGesture = (
  drawerRef: RefObject<HTMLDivElement | null>,
  maskRef: RefObject<HTMLDivElement | null>
) => {
  const draggingRef = useRef(false)
  const open = useMobileSider((state) => state.open)

  // 非拖拽状态下把画面推到目标位置，动画交给 CSS transition
  useEffect(() => {
    const drawer = drawerRef.current
    const mask = maskRef.current
    if (!drawer || !mask || draggingRef.current) {
      return
    }
    const width = drawer.offsetWidth
    const target = open ? width : 0
    drawer.style.transform = `translate3d(${target - width}px, 0, 0)`
    mask.style.opacity = width > 0 && open ? '1' : '0'
    mask.style.pointerEvents = open ? 'auto' : 'none'
    drawer.style.pointerEvents = open ? 'auto' : 'none'
  }, [open, drawerRef, maskRef])

  useEffect(() => {
    const drawer = drawerRef.current
    const mask = maskRef.current
    if (!drawer || !mask) {
      return
    }

    let width = drawer.offsetWidth
    let startX = 0
    let startY = 0
    let startAt = 0
    let base = 0
    let mode: 'idle' | 'undecided' | 'drag' | 'ignore' = 'idle'

    const apply = (next: number) => {
      const offset = Math.max(0, Math.min(width, next))
      drawer.style.transform = `translate3d(${offset - width}px, 0, 0)`
      mask.style.opacity = width > 0 ? String(Math.min(1, offset / width)) : '0'
      const active = offset > 0
      mask.style.pointerEvents = active ? 'auto' : 'none'
      drawer.style.pointerEvents = active ? 'auto' : 'none'
    }

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        mode = 'idle'
        return
      }
      const isOpen = useMobileSider.getState().open
      const touch = event.touches[0]
      // 横向可滚动的内容自己先用这个手势
      if (insideHorizontalScroller(event.target)) {
        mode = 'ignore'
        return
      }
      width = drawer.offsetWidth || width
      base = isOpen ? width : 0
      startX = touch.clientX
      startY = touch.clientY
      startAt = Date.now()
      mode = 'undecided'
    }

    const onMove = (event: TouchEvent) => {
      if (mode !== 'undecided' && mode !== 'drag') {
        return
      }
      if (event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (mode === 'undecided') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
          return
        }
        // 竖向占优就当成滚动，交给页面自己处理
        if (Math.abs(dy) >= Math.abs(dx)) {
          mode = 'ignore'
          return
        }
        mode = 'drag'
        draggingRef.current = true
        drawer.classList.add(styles.drawerDragging)
        mask.classList.add(styles.maskDragging)
      }

      // 已经确认是横向拖拽，阻止页面跟着滚动
      event.preventDefault()
      apply(base + dx)
    }

    const settle = (clientX: number) => {
      if (mode !== 'drag') {
        mode = 'idle'
        return
      }
      const dx = clientX - startX
      const elapsed = Math.max(1, Date.now() - startAt)
      const velocity = dx / elapsed
      const current = base + dx
      const shouldOpen =
        Math.abs(velocity) > FLING ? velocity > 0 : current > width * RATIO

      mode = 'idle'
      draggingRef.current = false
      drawer.classList.remove(styles.drawerDragging)
      mask.classList.remove(styles.maskDragging)
      apply(shouldOpen ? width : 0)
      if (shouldOpen) {
        openMobileSider()
      } else {
        closeMobileSider()
      }
    }

    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      settle(touch ? touch.clientX : startX)
    }

    const onCancel = () => {
      if (mode === 'drag') {
        draggingRef.current = false
        drawer.classList.remove(styles.drawerDragging)
        mask.classList.remove(styles.maskDragging)
        apply(useMobileSider.getState().open ? width : 0)
      }
      mode = 'idle'
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onCancel)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
    }
  }, [drawerRef, maskRef])
}
