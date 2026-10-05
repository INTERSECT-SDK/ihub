'use client'

import { ChatMessage } from '@ihub/utils/types/chat'
import { useCallback, useEffect, useRef, useState } from 'react'

type UseChatScrollOptions = {
  messages: ChatMessage[]
  agentProcessing: boolean
}

/**
 * Manages chat viewport auto-scroll behavior.
 *
 * The hook tracks whether the user is near the bottom, exposes the jump control
 * state, and scrolls after layout updates while preserving the user's reading
 * position when they intentionally scroll away from the latest message.
 */
export function useChatScroll({
  messages,
  agentProcessing,
}: UseChatScrollOptions) {
  const chatAreaRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  useEffect(() => {
    const el = chatAreaRef.current
    if (!el) {
      return
    }

    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight
      shouldAutoScrollRef.current = distanceFromBottom <= 80
      setShowScrollToBottom(distanceFromBottom > 220)
    }

    onScroll()
    el.addEventListener('scroll', onScroll)

    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    const el = chatAreaRef.current
    if (!el) return

    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
      setShowScrollToBottom(false)
    })
    return () => cancelAnimationFrame(raf)
  }, [agentProcessing, messages])

  /**
   * Scrolls to the newest chat content and re-enables automatic scrolling.
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = chatAreaRef.current
    if (!el) {
      return
    }

    el.scrollTo({ top: el.scrollHeight, behavior })
    shouldAutoScrollRef.current = true
    setShowScrollToBottom(false)
  }, [])

  /**
   * Allows the next message or streaming update to follow the bottom again.
   */
  const enableAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true
  }, [])

  return {
    chatAreaRef,
    showScrollToBottom,
    scrollToBottom,
    enableAutoScroll,
  }
}
