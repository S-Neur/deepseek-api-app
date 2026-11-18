import { create } from 'zustand'
import { popLayer, pushLayer } from '../../app/navStack.js'
import type { Source } from '../../services/chat/view.js'

/** 右侧「搜索结果」面板：同一入口再次点击收起，换入口时替换内容 */
type SearchPanelState = {
  /** 打开面板的入口，用于判断再次点击是否收起 */
  entry: string | null
  sources: Source[]
}

export const useSearchPanel = create<SearchPanelState>(() => ({ entry: null, sources: [] }))

export const toggleSearchPanel = (entry: string, sources: Source[]) => {
  const same = useSearchPanel.getState().entry === entry
  if (same) {
    popLayer('search')
    useSearchPanel.setState({ entry: null, sources: [] })
    return
  }
  pushLayer('search')
  useSearchPanel.setState({ entry, sources })
}

export const closeSearchPanel = () => {
  popLayer('search')
  useSearchPanel.setState({ entry: null, sources: [] })
}
