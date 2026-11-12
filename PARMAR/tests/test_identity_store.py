from uuid import uuid4

import pytest

from PARMAR.identity_store import (
    IdentityAccessDenied,
    IdentityStorageUnavailable,
    SQLiteIdentityRepository,
)


def test_profiles_and_workspaces_persist_with_server_owned_membership(tmp_path):
    database_path = tmp_path / "identity.sqlite3"
    first_user = uuid4()
    second_user = uuid4()
    repository = SQLiteIdentityRepository(database_path)

    personal = repository.create_profile(first_user, " Personal ")
    assert database_path.stat().st_mode & 0o777 == 0o600
    team_profile = repository.create_profile(first_user, "Team")
    workspace = repository.create_workspace(first_user, "Family")
    other_user_profile = repository.create_profile(second_user, "Other user")
    other_workspace = repository.create_workspace(second_user, "Other workspace")
    repository.add_profile_to_workspace(first_user, workspace.workspace_id, team_profile.profile_id)

    restarted = SQLiteIdentityRepository(database_path)

    assert [profile.name for profile in restarted.list_profiles(first_user)] == ["Personal", "Team"]
    assert [profile.name for profile in restarted.list_profiles(second_user)] == ["Other user"]
    assert [(item.workspace_id, item.role) for item in restarted.list_workspaces(first_user)] == [
        (workspace.workspace_id, "OWNER"),
    ]
    assert [profile.profile_id for profile in restarted.list_workspace_profiles(
        first_user,
        workspace.workspace_id,
    )] == [team_profile.profile_id]
    assert personal.profile_id != team_profile.profile_id
    assert other_workspace.owner_user_id == second_user


def test_foreign_profiles_and_workspaces_are_not_accessible_or_shareable(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    owner = uuid4()
    stranger = uuid4()
    profile = repository.create_profile(owner, "Private")
    workspace = repository.create_workspace(owner, "Private workspace")
    stranger_profile = repository.create_profile(stranger, "Stranger")
    stranger_workspace = repository.create_workspace(stranger, "Stranger workspace")

    with pytest.raises(IdentityAccessDenied):
        repository.add_profile_to_workspace(
            stranger,
            workspace.workspace_id,
            stranger_profile.profile_id,
        )
    with pytest.raises(IdentityAccessDenied):
        repository.add_profile_to_workspace(
            owner,
            stranger_workspace.workspace_id,
            profile.profile_id,
        )
    with pytest.raises(IdentityAccessDenied):
        repository.list_workspace_profiles(stranger, workspace.workspace_id)
    assert repository.list_workspace_profiles(owner, workspace.workspace_id) == []
    assert repository.list_workspaces(stranger) == [stranger_workspace]


def test_profile_and_workspace_names_are_bounded_and_nonempty(tmp_path):
    repository = SQLiteIdentityRepository(tmp_path / "identity.sqlite3")
    user_id = uuid4()

    for invalid in ("", "   ", "x" * 81, None):
        with pytest.raises(ValueError):
            repository.create_profile(user_id, invalid)
    for invalid in ("", "   ", "x" * 101, None):
        with pytest.raises(ValueError):
            repository.create_workspace(user_id, invalid)


def test_corrupt_identity_storage_fails_closed_without_replacing_file(tmp_path):
    database_path = tmp_path / "identity.sqlite3"
    original = b"not a sqlite database"
    database_path.write_bytes(original)
    repository = SQLiteIdentityRepository(database_path)

    with pytest.raises(IdentityStorageUnavailable):
        repository.list_profiles(uuid4())

    assert database_path.read_bytes() == original
