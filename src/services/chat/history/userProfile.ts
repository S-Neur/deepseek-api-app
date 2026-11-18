/**
 * 归档里的 user.json 原文。
 *
 * 官方导出会带账号信息（已脱敏）。导入时我们不用它，但如果直接丢掉，
 * 再导出时就会缺这一个条目，归档就和原版对不上了——所以原样存下来，导出时写回去。
 */
const KEY = 'chat-demo:user-profile'

export const saveUserProfile = (text: string) => {
  try {
    localStorage.setItem(KEY, text)
  } catch {
    // 存不下就退化成导出空对象
  }
}

export const loadUserProfile = (): string | null => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
