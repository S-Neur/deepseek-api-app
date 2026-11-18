const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

const toDate = (value: string | number | Date): Date | null => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDate = (
  value: string | number | Date,
  separator: '/' | '-' = '-'
): string | null => {
  const date = toDate(value)
  if (!date) {
    return null
  }
  return [pad(date.getFullYear(), 4), pad(date.getMonth() + 1), pad(date.getDate())].join(separator)
}

export const monthKey = (value: string | number | Date): string | null => {
  const date = toDate(value)
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : null
}

/** 消息时间：今天显示时:分，今年显示月-日，跨年带上年份 */
export const formatMessageTime = (value: number, now = Date.now()): string | null => {
  const date = toDate(value)
  if (!date) {
    return null
  }
  const current = new Date(now)
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (current.toDateString() === date.toDateString()) {
    return clock
  }
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return current.getFullYear() === date.getFullYear()
    ? `${monthDay} ${clock}`
    : `${date.getFullYear()}-${monthDay} ${clock}`
}

/** token 数缩写：1234 → 1.2K，1234567 → 1.2M */
export const formatTokens = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }
  if (value < 1000) {
    return String(Math.round(value))
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`
  }
  return `${(value / 1_000_000).toFixed(1)}M`
}
