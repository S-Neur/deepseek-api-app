import { create } from 'zustand'

/** 覆盖在页面之上的层：抽屉、设置、搜索面板、轮次面板 */
export type NavLayer = 'sider' | 'settings' | 'search' | 'turns'

/**
 * 返回键的层级栈。
 *
 * 只记录"浮在页面上的东西"，不含页面本身（主页 / 对话页由 activeId 表示）。
 * 打开层时压栈、关闭时出栈，返回键永远弹栈顶，所以：
 * 抽屉 → 设置 → 返回 = 先关设置，仍停在抽屉；再返回才关抽屉；再返回才回主页；再返回才退出。
 */
export const useNavStack = create(() => ({ layers: [] as NavLayer[] }))

export const pushLayer = (layer: NavLayer) =>
  useNavStack.setState((state) => ({
    layers: state.layers.includes(layer) ? state.layers : [...state.layers, layer],
  }))

export const popLayer = (layer: NavLayer) =>
  useNavStack.setState((state) => ({ layers: state.layers.filter((item) => item !== layer) }))

export const topLayer = (): NavLayer | null => useNavStack.getState().layers.at(-1) ?? null
