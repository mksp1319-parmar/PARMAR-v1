from uuid import uuid4

import pytest

from PARMAR.conversations import (
    MAX_CONVERSATION_CHARACTERS,
    MAX_CONVERSATIONS_PER_USER,
    MAX_MESSAGE_LENGTH,
    MAX_MESSAGES_PER_CONVERSATION,
    ConversationLimitExceeded,
    InMemoryConversationRepository,
)


def test_create_generates_server_id_and_records_owner():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()

    conversation = repository.create(owner_user_id)

    assert conversation.conversation_id != owner_user_id
    assert conversation.conversation_id.version == 4
    assert repository.get_owned(conversation.conversation_id, owner_user_id) == conversation
    assert repository.get_owned(conversation.conversation_id, uuid4()) is None


def test_unknown_conversation_cannot_be_read_or_changed():
    repository = InMemoryConversationRepository()

    assert repository.get_owned(uuid4(), uuid4()) is None
    assert repository.recent_owned(uuid4(), uuid4(), 12) is None
    assert repository.append_owned(uuid4(), uuid4(), (("user", "hello"),)) is None
    assert repository.delete_owned(uuid4(), uuid4()) is False


def test_messages_are_owned_by_their_conversation_and_recent_history_is_bounded():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)
    inserted = repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (
            ("user", "first"),
            ("assistant", "second"),
            ("user", "third"),
        ),
    )

    assert inserted is not None
    updated = repository.get_owned(conversation.conversation_id, owner_user_id)
    assert updated is not None
    assert updated.updated_at > conversation.updated_at
    assert all(record.conversation_id == conversation.conversation_id for record in inserted)
    assert [record.content for record in repository.recent_owned(
        conversation.conversation_id,
        owner_user_id,
        2,
    )] == ["second", "third"]
    assert repository.recent_owned(conversation.conversation_id, uuid4(), 12) is None
    assert repository.append_owned(
        conversation.conversation_id,
        uuid4(),
        (("user", "forged"),),
    ) is None
    assert repository.get_owned(conversation.conversation_id, owner_user_id) == updated
    assert [record.content for record in repository.recent_owned(
        conversation.conversation_id,
        owner_user_id,
        12,
    )] == ["first", "second", "third"]


def test_delete_requires_owner_and_removes_conversation_messages():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)
    repository.append_owned(conversation.conversation_id, owner_user_id, (("user", "hello"),))

    assert repository.delete_owned(conversation.conversation_id, uuid4()) is False
    assert repository.get_owned(conversation.conversation_id, owner_user_id) is not None
    assert repository.delete_owned(conversation.conversation_id, owner_user_id) is True
    assert repository.get_owned(conversation.conversation_id, owner_user_id) is None
    assert repository.recent_owned(conversation.conversation_id, owner_user_id, 12) is None


def test_repository_sanitizes_sensitive_message_content():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)

    stored = repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (("user", "My API key is sk-12345678901234567890"),),
    )

    assert stored is not None
    assert "sk-12345678901234567890" not in stored[0].content
    assert "[REDACTED]" in stored[0].content


def test_repository_does_not_persist_cookie_or_session_tokens():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)

    stored = repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (("user", "Cookie: session=private\nCSRF token: private-csrf"),),
    )

    assert stored is not None
    assert "private" not in stored[0].content
    assert "private-csrf" not in stored[0].content


def test_message_size_limit_allows_boundary_and_rejects_oversized_message():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)

    assert repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (("user", "x" * MAX_MESSAGE_LENGTH),),
    ) is not None
    with pytest.raises(ConversationLimitExceeded):
        repository.append_owned(
            conversation.conversation_id,
            owner_user_id,
            (("user", "x" * (MAX_MESSAGE_LENGTH + 1)),),
        )


def test_message_count_quota_is_atomic_and_cannot_be_bypassed_by_repeated_appends():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)
    pair = (("user", "x"), ("assistant", "y"))

    for _ in range(MAX_MESSAGES_PER_CONVERSATION // len(pair)):
        assert repository.can_append_owned(conversation.conversation_id, owner_user_id, "x") is True
        assert repository.append_owned(conversation.conversation_id, owner_user_id, pair) is not None
    assert len(repository.recent_owned(
        conversation.conversation_id,
        owner_user_id,
        MAX_MESSAGES_PER_CONVERSATION + 1,
    )) == MAX_MESSAGES_PER_CONVERSATION
    assert repository.can_append_owned(conversation.conversation_id, owner_user_id, "x") is False
    with pytest.raises(ConversationLimitExceeded):
        repository.append_owned(conversation.conversation_id, owner_user_id, pair)


def test_total_conversation_character_quota_accepts_boundary_and_rejects_next_append():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)
    full_chunks, final_size = divmod(MAX_CONVERSATION_CHARACTERS, MAX_MESSAGE_LENGTH)
    for _ in range(full_chunks):
        assert repository.append_owned(
            conversation.conversation_id,
            owner_user_id,
            (("user", "x" * MAX_MESSAGE_LENGTH),),
        ) is not None
    if final_size:
        assert repository.append_owned(
            conversation.conversation_id,
            owner_user_id,
            (("assistant", "y" * final_size),),
        ) is not None
    assert repository.can_append_owned(conversation.conversation_id, owner_user_id, "x") is False
    with pytest.raises(ConversationLimitExceeded):
        repository.append_owned(
            conversation.conversation_id,
            owner_user_id,
            (("user", "z"),),
        )


def test_conversation_count_quota_is_per_user_and_has_no_silent_eviction():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    other_user_id = uuid4()
    created = [
        repository.create(owner_user_id)
        for _ in range(MAX_CONVERSATIONS_PER_USER)
    ]

    with pytest.raises(ConversationLimitExceeded):
        repository.create(owner_user_id)
    other_conversation = repository.create(other_user_id)

    assert all(repository.get_owned(item.conversation_id, owner_user_id) == item for item in created)
    assert repository.get_owned(other_conversation.conversation_id, other_user_id) == other_conversation


def test_delete_releases_conversation_and_global_character_quotas():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    conversation = repository.create(owner_user_id)
    repository.append_owned(conversation.conversation_id, owner_user_id, (("user", "x" * 100),))

    assert repository.delete_owned(conversation.conversation_id, owner_user_id) is True
    replacement = repository.create(owner_user_id)
    assert repository.append_owned(replacement.conversation_id, owner_user_id, (("user", "y" * 100),)) is not None
