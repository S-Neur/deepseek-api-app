import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../services/api/client.js'
import { transcribe } from '../../services/api/speech.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

/**
 * 录音依赖 getUserMedia，只在安全上下文可用（HTTPS、localhost、file://）。
 * 普通 HTTP 页面上直接禁用入口，避免点击后必然失败。
 */
const AVAILABLE = typeof window === 'undefined' || window.isSecureContext

/**
 * 失败原因直接展示原始信息（而不是一句"语音输入失败"）。
 * 自建客户端最难排查的就是 WebView 的能力差异，把名字和消息露出来才能对症下药。
 */
const describeRecordingError = (error: unknown): string => {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  const hint =
    typeof window !== 'undefined' && !window.isSecureContext
      ? '（页面不是安全上下文，需要 HTTPS）'
      : typeof navigator !== 'undefined' && !navigator.mediaDevices
        ? '（WebView 未提供 navigator.mediaDevices）'
        : ''
  return `录音失败${hint}：${[name, message].filter(Boolean).join(' ')}`
}

const describeTranscribeError = (error: unknown): string => {
  if (error instanceof ApiError) {
    return `转写失败（${error.status ?? error.kind}）：${error.message}`
  }
  return `转写失败：${error instanceof Error ? error.message : String(error)}`
}

/** 环境本身不具备录音条件时的说明 */
const describeUnavailable = (): string => {
  const parts = [
    `语音输入不可用`,
    `isSecureContext=${String(window.isSecureContext)}`,
    `origin=${location.origin}`,
  ]
  if (!navigator.mediaDevices) {
    parts.push('mediaDevices 未提供')
  }
  if (!window.isSecureContext) {
    parts.push('需要 HTTPS')
  }
  return parts.join('，')
}

/**
 * 语音输入（oneshot）：点击开始录音，再次点击结束并转写，结果交给 onText 填入输入框。
 * 转写中再次点击取消。录满 120 秒自动结束。
 */
export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  /** 本次录音已录秒数，只在录音中递增 */
  const [seconds, setSeconds] = useState(0)
  const recordingRef = useRef<Recording | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const cancelOperation = useCallback(() => {
    operationRef.current++
    recordingRef.current?.cancel()
    recordingRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const cancel = useCallback(() => {
    cancelOperation()
    setStatus('idle')
  }, [cancelOperation])

  const finish = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) {
      // 仍在等待麦克风授权时也允许取消；迟到的录音对象会立即释放。
      cancel()
      return
    }
    const operation = operationRef.current
    recordingRef.current = null
    let controller: AbortController | null = null
    try {
      let audio: Blob | null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }
      if (operationRef.current !== operation) {
        return
      }
      if (!audio) {
        // 采到 0 个样本：AudioContext 被挂起，或麦克风没有输入
        showToast('没有采集到音频：AudioContext 可能被挂起，或麦克风没有输入')
        return
      }
      controller = new AbortController()
      controllerRef.current = controller
      setStatus('transcribing')
      const text = await transcribe(useSettings.getState().apiKey ?? '', audio, controller.signal)
      if (controller.signal.aborted || operationRef.current !== operation) {
        return
      }
      if (text.trim()) {
        onTextRef.current(text.trim())
      } else {
        showToast({ key: 'voiceInputEmpty' })
      }
    } catch (error) {
      if (operationRef.current === operation && !controller?.signal.aborted) {
        showToast(describeTranscribeError(error))
      }
    } finally {
      if (operationRef.current === operation) {
        controllerRef.current = null
        setStatus('idle')
      }
    }
  }, [cancel])

  const toggle = useCallback(async () => {
    if (!AVAILABLE) {
      showToast(describeUnavailable())
      return
    }
    if (status === 'recording') {
      await finish()
      return
    }
    if (status === 'transcribing') {
      cancel()
      return
    }
    const operation = ++operationRef.current
    setStatus('recording')
    try {
      const recording = await startRecording(() => {
        if (operationRef.current === operation) {
          showToast({ key: 'voiceInputLimitReached' })
          void finish()
        }
      })
      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }
      recordingRef.current = recording
    } catch (error) {
      if (operationRef.current === operation) {
        setStatus('idle')
        showToast(describeRecordingError(error))
      }
    }
  }, [status, finish, cancel])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    // 半秒刷新一次，让显示的秒数与实际录音时长保持一致
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => cancelOperation, [cancelOperation])

  /** 当前录音的频谱分析节点，未录音时为 null */
  const getAnalyser = useCallback(() => recordingRef.current?.analyser ?? null, [])

  return { status, seconds, getAnalyser, toggle, cancel, available: AVAILABLE }
}
