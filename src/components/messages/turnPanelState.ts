import { create } from 'zustand'
import { popLayer, pushLayer } from '../../app/navStack.js'

/**
 * 轮次面板的开合。放进导航栈，返回键才能先关它再关别的。
 */
export const useTurnPanel = create(() => ({ open: false }))

export const openTurnPanel = () => {
  pushLayer('turns')
  useTurnPanel.setState({ open: true })
}

export const closeTurnPanel = () => {
  popLayer('turns')
  useTurnPanel.setState({ open: false })
}
