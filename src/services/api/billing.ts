import * as db from '../chat/db.js'
import { API_ORIGIN, request } from './client.js'

/** GET /user/balance 的响应 */
export type BalanceInfo = {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export type Balance = {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

/** 查询当前 API Key 的余额（官方接口，不产生费用） */
export const fetchBalance = async (apiKey: string, signal?: AbortSignal): Promise<Balance> => {
  const response = await request(`${API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  const body = (await response.json()) as Balance
  if (!body || !Array.isArray(body.balance_infos)) {
    throw new Error('unexpected balance response')
  }
  return body
}

export type LocalUsage = {
  /** 未命中缓存的输入 + 缓存写入 */
  input: number
  /** 命中缓存的输入 */
  cached: number
  output: number
  /** 有 usage 记录的助手回复轮数 */
  turns: number
}

/** 累加本地全部会话的 token 用量；会话多时按需调用（几百个会话约一两秒） */
export const sumLocalUsage = async (): Promise<LocalUsage> => {
  const summaries = await db.loadSessionSummaries()
  const usage: LocalUsage = { input: 0, cached: 0, output: 0, turns: 0 }
  for (const summary of summaries) {
    const session = await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    for (const message of session.messages) {
      if (message.role !== 'assistant' || !message.usage) {
        continue
      }
      usage.turns += 1
      usage.input += message.usage.input_tokens + message.usage.cache_creation_input_tokens
      usage.cached += message.usage.cache_read_input_tokens
      usage.output += message.usage.output_tokens
    }
  }
  return usage
}
