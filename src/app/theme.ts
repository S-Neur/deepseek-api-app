import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'

export type Theme = 'light' | 'dark'

/** 原生壳注入的系统深浅色（WebView 里 prefers-color-scheme 不一定可靠） */
declare global {
  interface Window {
    AppHost?: {
      isSystemDark: () => boolean
      setStatusBar: (hexColor: string, darkIcons: boolean) => void
      exportBegin?: (fileName: string) => string
      exportChunk?: (token: string, base64: string) => boolean
      exportEnd?: (token: string) => string
      exportAbort?: (token: string) => void
    }
    __setSystemDark?: (dark: boolean) => void
    __appBack?: () => boolean
  }
}

const query = window.matchMedia('(prefers-color-scheme: dark)')

/** 优先用原生给的值；纯浏览器环境下退回 matchMedia */
let nativeDark: boolean | null = null
try {
  const value = window.AppHost?.isSystemDark?.()
  if (typeof value === 'boolean') {
    nativeDark = value
  }
} catch {
  nativeDark = null
}

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  const onNative = () => listener()
  window.addEventListener('systemthemechange', onNative)
  return () => {
    query.removeEventListener('change', listener)
    window.removeEventListener('systemthemechange', onNative)
  }
}

const getOsTheme = (): Theme => {
  if (nativeDark !== null) {
    return nativeDark ? 'dark' : 'light'
  }
  return query.matches ? 'dark' : 'light'
}

/** 原生壳在系统切换深浅色时调用 */
window.__setSystemDark = (dark: boolean) => {
  nativeDark = dark
  window.dispatchEvent(new Event('systemthemechange'))
}

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
}

/** 把 rgba()/rgb() 转成 #rrggbb（原生侧只认后者） */
const toHex = (css: string): string | null => {
  const match = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) {
    return null
  }
  return '#' + [1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')
}

/** 状态栏跟随应用背景色；浅色背景用深色图标 */
const syncNativeBars = (theme: Theme) => {
  const hex = toHex(getComputedStyle(document.body).backgroundColor)
  if (!hex) {
    return
  }
  try {
    window.AppHost?.setStatusBar(hex, theme === 'light')
  } catch {
    // 纯浏览器环境没有原生壳
  }
}

/** 同步页面主题、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  syncNativeBars(theme)
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

let appliedTheme: Theme | null = null

const syncTheme = () => {
  const theme = resolveTheme(useSettings.getState().themePreference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
}
