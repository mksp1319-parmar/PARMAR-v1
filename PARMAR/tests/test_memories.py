from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from PARMAR.memories import (
    InMemoryMemoryRepository,
    MAX_MEMORY_RECORDS,
    MAX_RETRIEVED_MEMORIES,
    MAX_RETRIEVED_MEMORY_CHARS,
    MAX_RETRIEVAL_QUERY_CHARS,
    MAX_RETRIEVAL_TERMS,
    MemoryConsentRequired,
)


def test_explicit_consent_is_required_and_revocation_blocks_create_and_update():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()

    with pytest.raises(MemoryConsentRequired):
        repository.create_owned(owner_user_id, "Prefers concise notes")

    consent = repository.set_consent(owner_user_id, True)
    assert consent.granted is True
    record = repository.create_owned(owner_user_id, "Prefers concise notes")
    updated = repository.update_owned(record.memory_id, owner_user_id, "Prefers short summaries")
    assert updated is not None
    assert updated.content == "Prefers short summaries"

    consent = repository.set_consent(owner_user_id, False)
    assert consent.granted is False
    with pytest.raises(MemoryConsentRequired):
        repository.create_owned(owner_user_id, "Another note")
    with pytest.raises(MemoryConsentRequired):
        repository.update_owned(record.memory_id, owner_user_id, "Changed without consent")
    assert repository.list_owned(owner_user_id) == (updated,)


def test_memory_crud_and_ownership_isolation():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    other_user_id = uuid4()
    repository.set_consent(owner_user_id, True)
    record = repository.create_owned(owner_user_id, "Prefers concise notes")

    assert repository.list_owned(owner_user_id) == (record,)
    assert repository.list_owned(other_user_id) == ()
    assert repository.update_owned(record.memory_id, other_user_id, "stolen") is None
    assert repository.delete_owned(record.memory_id, other_user_id) is False
    assert repository.list_owned(owner_user_id) == (record,)

    updated = repository.update_owned(record.memory_id, owner_user_id, "Prefers concise summaries")
    assert updated is not None
    assert updated.created_at == record.created_at
    assert updated.updated_at > record.updated_at
    assert updated.provenance == "explicit_user_update"
    assert repository.delete_owned(record.memory_id, owner_user_id) is True
    assert repository.list_owned(owner_user_id) == ()


def test_unknown_and_malformed_memory_ids_fail_safely():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()

    assert repository.update_owned("not-a-uuid", owner_user_id, "note") is None
    assert repository.delete_owned("not-a-uuid", owner_user_id) is False
    assert repository.update_owned(uuid4(), owner_user_id, "note") is None
    assert repository.delete_owned(uuid4(), owner_user_id) is False


def test_credential_like_memory_is_rejected_without_echoing_value():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    repository.set_consent(owner_user_id, True)

    for content in (
        "My password is top-secret-value",
        "API key: sk-12345678901234567890",
        "Bearer abcdefghijklmnopqrstuvwxyz123",
        "-----BEGIN RSA PRIVATE KEY-----",
        "session_token=private-session-token",
    ):
        with pytest.raises(ValueError) as error:
            repository.create_owned(owner_user_id, content)
        assert "top-secret-value" not in str(error.value)
        assert "private-session-token" not in str(error.value)

    assert repository.list_owned(owner_user_id) == ()


def test_repository_is_thread_safe_for_concurrent_creation():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    repository.set_consent(owner_user_id, True)

    with ThreadPoolExecutor(max_workers=8) as executor:
        records = list(executor.map(
            lambda index: repository.create_owned(owner_user_id, f"Note {index}"),
            range(20),
        ))

    assert len({record.memory_id for record in records}) == 20
    assert len(repository.list_owned(owner_user_id)) == 20


def test_retrieval_requires_consent_and_returns_only_relevant_owned_memories():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    other_user_id = uuid4()

    assert repository.retrieve_owned(owner_user_id, "project planning") == ()
    repository.set_consent(owner_user_id, True)
    relevant = repository.create_owned(owner_user_id, "Project planning includes review milestones")
    less_relevant = repository.create_owned(owner_user_id, "Project status is shared weekly")
    repository.create_owned(owner_user_id, "Favorite color is blue")
    repository.set_consent(other_user_id, True)
    repository.create_owned(other_user_id, "Project planning notes for another owner")

    results = repository.retrieve_owned(owner_user_id, "How should project planning work?")
    assert results == (relevant, less_relevant)
    assert repository.retrieve_owned(other_user_id, "project planning") == (
        repository.list_owned(other_user_id)[0],
    )
    assert repository.retrieve_owned(owner_user_id, "the and what") == ()

    repository.set_consent(owner_user_id, False)
    assert repository.retrieve_owned(owner_user_id, "project planning") == ()


def test_retrieval_is_deterministic_and_bounded_by_count_and_total_characters():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    repository.set_consent(owner_user_id, True)

    short_records = [
        repository.create_owned(owner_user_id, f"Project planning preference {index}")
        for index in range(MAX_MEMORY_RECORDS)
    ]
    first = repository.retrieve_owned(owner_user_id, "project planning")
    second = repository.retrieve_owned(owner_user_id, "project planning")
    assert first == second
    assert len(first) == MAX_RETRIEVED_MEMORIES
    assert all(record in short_records for record in first)

    for record in short_records:
        repository.delete_owned(record.memory_id, owner_user_id)
    long_records = [
        repository.create_owned(owner_user_id, f"Project planning {index} " + ("x" * 375))
        for index in range(MAX_MEMORY_RECORDS)
    ]
    bounded = repository.retrieve_owned(owner_user_id, "project planning")
    assert len(bounded) == MAX_RETRIEVED_MEMORY_CHARS // 400
    assert sum(len(record.content) for record in bounded) <= MAX_RETRIEVED_MEMORY_CHARS
    assert all(record in long_records for record in bounded)


def test_retrieval_ignores_query_text_beyond_fixed_limit_and_wrong_owner():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    other_user_id = uuid4()
    repository.set_consent(owner_user_id, True)
    repository.set_consent(other_user_id, True)
    record = repository.create_owned(owner_user_id, "Astronomy telescope observations")
    other_record = repository.create_owned(other_user_id, "Astronomy telescope observations")

    query = "x" * MAX_RETRIEVAL_QUERY_CHARS + " astronomy telescope"
    assert repository.retrieve_owned(owner_user_id, query) == ()
    assert repository.retrieve_owned(other_user_id, "astronomy telescope") == (other_record,)
    assert record != other_record


def test_retrieval_term_work_is_capped():
    repository = InMemoryMemoryRepository()
    owner_user_id = uuid4()
    repository.set_consent(owner_user_id, True)
    repository.create_owned(owner_user_id, "needlelast")
    leading_terms = [
        f"word{chr(97 + index // 26)}{chr(97 + index % 26)}"
        for index in range(MAX_RETRIEVAL_TERMS)
    ]

    assert repository.retrieve_owned(owner_user_id, " ".join([*leading_terms, "needlelast"])) == ()
