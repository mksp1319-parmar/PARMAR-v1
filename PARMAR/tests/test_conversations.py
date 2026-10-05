import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from PARMAR.conversations import (
    MAX_CONVERSATION_CHARACTERS,
    MAX_CONVERSATION_TITLE_LENGTH,
    MAX_CONVERSATIONS_PER_USER,
    MAX_MESSAGE_LENGTH,
    MAX_MESSAGES_PER_CONVERSATION,
    MAX_RESEARCH_ENVELOPE_BYTES,
    ConversationLimitExceeded,
    ConversationStorageUnavailable,
    InMemoryConversationRepository,
    SQLiteConversationRepository,
)
from PARMAR.research.models import ResearchResult, ResearchSource, ResearchStatus


def test_create_generates_server_id_and_records_owner():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()

    conversation = repository.create(owner_user_id)

    assert conversation.conversation_id != owner_user_id
    assert conversation.conversation_id.version == 4
    assert repository.get_owned(conversation.conversation_id, owner_user_id) == conversation
    assert repository.get_owned(conversation.conversation_id, uuid4()) is None


def test_listing_omits_empty_conversations_and_uses_first_user_message_as_title():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    empty = repository.create(owner_user_id)
    conversation = repository.create(owner_user_id)
    first_message = "  Plan the launch\nwith a clear owner and timeline.  "
    repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (("user", first_message), ("assistant", "Released reply.")),
    )
    repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (("user", "A later message must not rename this conversation."),),
    )

    listed = repository.list_owned(owner_user_id)

    assert [item.conversation_id for item in listed] == [conversation.conversation_id]
    assert listed[0].conversation_id != empty.conversation_id
    assert listed[0].title == "Plan the launch with a clear owner and timeline."
    assert len(listed[0].title) <= MAX_CONVERSATION_TITLE_LENGTH


def test_conversation_title_is_safely_truncated_and_redacts_token_metadata():
    repository = InMemoryConversationRepository()
    owner_user_id = uuid4()
    long_conversation = repository.create(owner_user_id)
    secret_conversation = repository.create(owner_user_id)
    repository.append_owned(
        long_conversation.conversation_id,
        owner_user_id,
        (("user", "x" * (MAX_CONVERSATION_TITLE_LENGTH + 20)),),
    )
    repository.append_owned(
        secret_conversation.conversation_id,
        owner_user_id,
        (("user", "Session token: private-value"),),
    )

    listed = repository.list_owned(owner_user_id)
    titles = {item.conversation_id: item.title for item in listed}

    assert len(listed) == 1
    assert titles[long_conversation.conversation_id].endswith("...")
    assert len(titles[long_conversation.conversation_id]) == MAX_CONVERSATION_TITLE_LENGTH
    assert secret_conversation.conversation_id not in titles
    stored_secret_message = repository.recent_owned(secret_conversation.conversation_id, owner_user_id, 1)[0]
    assert "private-value" not in stored_secret_message.content


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


def test_sqlite_repository_restarts_with_owned_messages_and_title_intact(tmp_path):
    database_path = tmp_path / "private" / "conversations.sqlite3"
    owner_user_id = uuid4()
    other_user_id = uuid4()
    first_repository = SQLiteConversationRepository(database_path)
    conversation = first_repository.create_for_message(owner_user_id, "Persist this conversation.")
    assert first_repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (
            ("user", "Persist this conversation."),
            ("assistant", "Only the released response belongs in history."),
        ),
    ) is not None

    restarted_repository = SQLiteConversationRepository(database_path)

    listed = restarted_repository.list_owned(owner_user_id)
    loaded = restarted_repository.recent_owned(conversation.conversation_id, owner_user_id, 12)
    assert [item.conversation_id for item in listed] == [conversation.conversation_id]
    assert listed[0].title == "Persist this conversation."
    assert [item.content for item in loaded] == [
        "Persist this conversation.",
        "Only the released response belongs in history.",
    ]
    assert restarted_repository.get_owned(conversation.conversation_id, other_user_id) is None
    assert restarted_repository.recent_owned(conversation.conversation_id, other_user_id, 12) is None


def test_released_research_metadata_persists_with_exact_owned_assistant_message_and_cascades(tmp_path):
    database_path = tmp_path / "research-conversations.sqlite3"
    owner_user_id, other_user_id = uuid4(), uuid4()
    repository = SQLiteConversationRepository(database_path)
    conversation = repository.create_for_message(owner_user_id, "Research photosynthesis.")
    source = ResearchSource(
        title="Photosynthesis",
        url="https://example.org/biology",
        domain="example.org",
        provider_id="http-json-search",
        source_id="result-1",
        snippet="Plant energy conversion.",
        metadata={"author": "Example Institute"},
    )
    result = ResearchResult(ResearchStatus.RESULTS, sources=(source,))
    stored = repository.append_owned(
        conversation.conversation_id,
        owner_user_id,
        (("user", "Research photosynthesis."), ("assistant", "Here is a summary.")),
        research=result,
    )
    assert stored is not None
    assert stored[0].research is None
    assert stored[1].research == result
    assert stored[1].research_retrieved_at is not None

    restarted = SQLiteConversationRepository(database_path)
    loaded = restarted.recent_owned(conversation.conversation_id, owner_user_id, 12)
    assert loaded is not None
    assert [message.research for message in loaded] == [None, result]
    assert loaded[1].research_retrieved_at is not None
    assert restarted.recent_owned(conversation.conversation_id, other_user_id, 12) is None
    assert restarted.delete_owned(conversation.conversation_id, other_user_id) is False
    assert restarted.delete_owned(conversation.conversation_id, owner_user_id) is True

    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM message_research").fetchone()[0] == 0


def test_no_results_status_persists_without_fabricating_sources(tmp_path):
    repository = SQLiteConversationRepository(tmp_path / "no-results.sqlite3")
    owner_id = uuid4()
    conversation = repository.create_for_message(owner_id, "Research unavailable subject.")
    result = ResearchResult(ResearchStatus.NO_RESULTS)

    repository.append_owned(
        conversation.conversation_id,
        owner_id,
        (("assistant", "The provider returned no results."),),
        research=result,
    )
    restored = SQLiteConversationRepository(tmp_path / "no-results.sqlite3").recent_owned(
        conversation.conversation_id,
        owner_id,
        12,
    )

    assert restored is not None
    assert restored[0].research == result
    assert restored[0].research.sources == ()


def test_failed_research_child_insert_rolls_back_assistant_and_user_messages(tmp_path):
    database_path = tmp_path / "atomic-research.sqlite3"
    owner_id = uuid4()
    repository = SQLiteConversationRepository(database_path)
    conversation = repository.create_for_message(owner_id, "Atomic source persistence.")
    source = ResearchSource(
        title="Source",
        url="https://example.org/source",
        domain="example.org",
        provider_id="http-json-search",
        source_id="result-1",
    )
    research = ResearchResult(ResearchStatus.RESULTS, sources=(source,))
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TRIGGER reject_research_insert BEFORE INSERT ON message_research "
            "BEGIN SELECT RAISE(ABORT, 'test transaction failure'); END"
        )

    with pytest.raises(ConversationStorageUnavailable):
        repository.append_owned(
            conversation.conversation_id,
            owner_id,
            (("user", "Atomic source persistence."), ("assistant", "Released answer.")),
            research=research,
        )
    assert repository.recent_owned(conversation.conversation_id, owner_id, 12) == ()


def test_sqlite_repository_migrates_version_one_without_inventing_research(tmp_path):
    database_path = tmp_path / "version-one.sqlite3"
    conversation_id, owner_id, message_id = uuid4(), uuid4(), uuid4()
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(database_path) as connection:
        connection.executescript("""
            CREATE TABLE conversations (
                conversation_id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX conversations_owner_updated
                ON conversations(owner_user_id, updated_at DESC);
            CREATE TABLE messages (
                message_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX messages_conversation_created
                ON messages(conversation_id, created_at, message_id);
            PRAGMA user_version = 1;
        """)
        connection.execute(
            "INSERT INTO conversations VALUES (?, ?, ?, ?, ?)",
            (str(conversation_id), str(owner_id), created_at, created_at, "Old conversation"),
        )
        connection.execute(
            "INSERT INTO messages VALUES (?, ?, 'assistant', ?, ?)",
            (str(message_id), str(conversation_id), "Old released message", created_at),
        )

    migrated = SQLiteConversationRepository(database_path)
    messages = migrated.recent_owned(conversation_id, owner_id, 12)
    assert messages is not None
    assert messages[0].content == "Old released message"
    assert messages[0].research is None
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM message_research").fetchone()[0] == 0


def test_failed_version_one_migration_rolls_back_schema_changes(tmp_path):
    database_path = tmp_path / "incompatible-version-one.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.executescript("""
            CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY);
            CREATE TABLE messages (message_id TEXT PRIMARY KEY);
            PRAGMA user_version = 1;
        """)

    with pytest.raises(ConversationStorageUnavailable):
        SQLiteConversationRepository(database_path).list_owned(uuid4())
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'message_research'"
        ).fetchone()[0] == 0


def test_research_envelope_size_limit_fails_before_any_message_is_written(tmp_path, monkeypatch):
    repository = SQLiteConversationRepository(tmp_path / "bounded-research.sqlite3")
    owner_id = uuid4()
    conversation = repository.create_for_message(owner_id, "Bounded source persistence.")
    result = ResearchResult(
        ResearchStatus.RESULTS,
        sources=(ResearchSource(
            title="Source",
            url="https://example.org/source",
            domain="example.org",
            provider_id="http-json-search",
            source_id="result-1",
        ),),
    )
    monkeypatch.setattr("PARMAR.conversations.MAX_RESEARCH_ENVELOPE_BYTES", 10)

    with pytest.raises(ConversationLimitExceeded):
        repository.append_owned(
            conversation.conversation_id,
            owner_id,
            (("user", "Bounded source persistence."), ("assistant", "Summary.")),
            research=result,
        )
    assert repository.recent_owned(conversation.conversation_id, owner_id, 12) == ()
    assert MAX_RESEARCH_ENVELOPE_BYTES == 128 * 1024


def test_corrupt_persisted_research_fails_closed(tmp_path):
    database_path = tmp_path / "corrupt-research.sqlite3"
    repository = SQLiteConversationRepository(database_path)
    owner_id = uuid4()
    conversation = repository.create_for_message(owner_id, "Stored response.")
    source = ResearchSource(
        title="Source",
        url="https://example.org/source",
        domain="example.org",
        provider_id="http-json-search",
        source_id="result-1",
    )
    stored = repository.append_owned(
        conversation.conversation_id,
        owner_id,
        (("assistant", "Released response."),),
        research=ResearchResult(ResearchStatus.RESULTS, sources=(source,)),
    )
    assert stored is not None
    with sqlite3.connect(database_path) as connection:
        connection.execute("UPDATE message_research SET payload = ?", ("{bad-json",))

    with pytest.raises(ConversationStorageUnavailable):
        SQLiteConversationRepository(database_path).recent_owned(
            conversation.conversation_id,
            owner_id,
            12,
        )


def test_sqlite_repository_keeps_empty_conversations_hidden_and_unknown_ids_safe(tmp_path):
    repository = SQLiteConversationRepository(tmp_path / "conversations.sqlite3")
    owner_user_id = uuid4()
    empty_conversation = repository.create(owner_user_id)

    assert repository.get_owned(empty_conversation.conversation_id, owner_user_id) == empty_conversation
    assert repository.list_owned(owner_user_id) == ()
    assert repository.recent_owned(uuid4(), owner_user_id, 12) is None
    assert repository.get_owned("malformed", owner_user_id) is None
    assert repository.delete_owned(empty_conversation.conversation_id, uuid4()) is False
    assert repository.delete_owned(empty_conversation.conversation_id, owner_user_id) is True
    assert repository.get_owned(empty_conversation.conversation_id, owner_user_id) is None


def test_sqlite_repository_fails_closed_for_corrupt_storage(tmp_path):
    database_path = tmp_path / "corrupt.sqlite3"
    database_path.write_bytes(b"not a sqlite database")
    repository = SQLiteConversationRepository(database_path)

    with pytest.raises(ConversationStorageUnavailable) as error:
        repository.list_owned(uuid4())

    assert "not a sqlite database" not in str(error.value).lower()


def test_sqlite_repository_does_not_recreate_missing_or_empty_prior_storage(tmp_path):
    missing_path = tmp_path / "removed.sqlite3"
    repository = SQLiteConversationRepository(missing_path)
    repository.create(uuid4())
    missing_path.unlink()

    with pytest.raises(ConversationStorageUnavailable):
        repository.list_owned(uuid4())
    assert not missing_path.exists()

    empty_path = tmp_path / "empty.sqlite3"
    empty_path.touch()
    with pytest.raises(ConversationStorageUnavailable):
        SQLiteConversationRepository(empty_path).list_owned(uuid4())
