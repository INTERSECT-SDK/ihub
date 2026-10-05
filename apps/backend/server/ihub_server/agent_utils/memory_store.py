"""Memory management for agents using LangChain."""

from __future__ import annotations

import logging
from typing import Any

from langchain_community.chat_message_histories import ChatMessageHistory, RedisChatMessageHistory

_log = logging.getLogger("ihub-server")


def build_buffer_memory(conversation_id: str) -> ChatMessageHistory:
    """
    Build a buffer memory that stores all messages in conversation history.

    Args:
        conversation_id: Unique conversation identifier

    Returns:
        ChatMessageHistory instance configured for the conversation
    """
    _log.info(f"conversation id: {conversation_id}")
    return ChatMessageHistory()


def build_vector_memory(conversation_id: str) -> RedisChatMessageHistory:
    """
    Build a vector memory using Redis for persistent conversation storage.

    Args:
        conversation_id: Unique conversation identifier

    Returns:
        RedisChatMessageHistory instance for vector-based memory
    """
    # Uses Redis as backend for chat message history
    # Requires Redis to be configured and running
    return RedisChatMessageHistory(
        session_id=conversation_id,
        url="redis://localhost:6379",  # TODO: Load from environment settings
    )


class MemoryStore:
    """Factory for creating and managing agent memory instances."""

    def get_memory(self, memory_type: str, conversation_id: str) -> Any:
        """
        Get a memory instance of the specified type.

        Args:
            memory_type: Type of memory ("buffer" or "vector")
            conversation_id: Unique conversation identifier

        Returns:
            Configured memory instance

        Raises:
            ValueError: If memory_type is not recognized
        """
        if memory_type == "buffer":
            return build_buffer_memory(conversation_id)
        if memory_type == "vector":
            return build_vector_memory(conversation_id)
        msg = f"Unknown memory type: {memory_type}"
        raise ValueError(msg)
