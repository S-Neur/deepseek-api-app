import * as db from '../db.js'
import type { Session } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import { loadUserProfile } from './userProfile.js'
import { writeArchive } from './zipWriter.js'

type Entry = { name: string; blob: Blob; compress?: boolean }

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 按导出格式生成 ZIP：manifest → user → 全部会话 JSON → index → 全部图片。
 * 与官方 App 导出的结构保持一致（JSON 用 DEFLATE、图片用 STORE），这样体积和可移植性都对得上。
 * 不含账号信息：user.json 只写空对象，导入端会跳过它。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>
): Promise<Blob> => {
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  // 导入时保留的 user.json 原文原样写回；没有（例如从零开始用）就写空对象
  const profile = loadUserProfile()
  const entries: Entry[] = [
    { name: MANIFEST_PATH, blob: json(manifest), compress: true },
    { name: USER_PATH, blob: new Blob([profile ?? '{}'], { type: 'application/json' }), compress: true },
  ]
  const imageEntries: Entry[] = []
  const index: SessionIndexEntry[] = []
  const originals = new Map<string, Blob | undefined>()
  for await (const session of sessions) {
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          if (file.isImage && !originals.has(file.id)) {
            originals.set(file.id, await db.loadFile(file.id))
          }
        }
      }
    }
    const images = new Map<string, Blob>()
    const data = toSessionFile(session, ({ id, name, isImage }) => {
      const blob = originals.get(id)
      if (!blob || !isImage) {
        return null
      }
      const path = imagePath(session.id, id, name)
      images.set(path, blob)
      return path
    })
    entries.push({ name: sessionPath(session.id), blob: json(data), compress: true })
    for (const [name, blob] of images) {
      // 图片本身已压缩，再 deflate 只会变慢不变小
      imageEntries.push({ name, blob })
    }
    index.push(toIndexEntry(data))
  }
  entries.push({ name: INDEX_PATH, blob: json(index), compress: true })
  return writeArchive(entries.concat(imageEntries))
}
