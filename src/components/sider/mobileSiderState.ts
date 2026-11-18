import { create } from 'zustand'
import { popLayer, pushLayer } from '../../app/navStack.js'

/** 移动端侧边栏抽屉：顶栏菜单按钮打开，点遮罩、切换会话或开启新对话后关闭 */
export const useMobileSider = create(() => ({ open: false }))

export const openMobileSider = () => {
  pushLayer('sider')
  useMobileSider.setState({ open: true })
}

export const closeMobileSider = () => {
  popLayer('sider')
  useMobileSider.setState({ open: false })
}
