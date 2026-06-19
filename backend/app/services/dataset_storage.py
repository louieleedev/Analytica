from __future__ import annotations

from uuid import uuid4
from typing import Any

import pandas as pd

from app.db.duckdb import get_connection


DATASET_TABLE_PREFIX = "dataset_"


def initialise_dataset_storage() -> None:
    for connection in get_connection():
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                dataset_id VARCHAR PRIMARY KEY,
                table_name VARCHAR NOT NULL UNIQUE,
                dataset_type VARCHAR NOT NULL,
                row_count BIGINT NOT NULL,
                column_count BIGINT NOT NULL,
                dataset_size BIGINT NOT NULL,
                has_headers BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _add_column_if_missing(connection, "datasets", "has_headers", "BOOLEAN DEFAULT TRUE")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_files (
                dataset_id VARCHAR NOT NULL,
                file_name VARCHAR NOT NULL,
                file_size BIGINT NOT NULL,
                status VARCHAR NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
            )
            """
        )
        _ensure_dataset_file_columns(connection)
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_columns (
                dataset_id VARCHAR NOT NULL,
                column_name VARCHAR NOT NULL,
                column_order INTEGER NOT NULL,
                detected_type VARCHAR NOT NULL,
                nullable BOOLEAN NOT NULL,
                example_value VARCHAR,
                FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
            )
            """
        )


def persist_dataset(
    dataset_id: str,
    frame: pd.DataFrame,
    dataset_type: str,
    files: list[dict[str, Any]],
    schema: list[dict[str, Any]],
    dataset_size: int,
    file_frames: list[pd.DataFrame] | None = None,
    has_headers: bool = True,
) -> str:
    initialise_dataset_storage()
    table_name = build_dataset_table_name(dataset_id)

    for connection in get_connection():
        connection.register("analytica_import_frame", frame)
        registered_file_frames: list[tuple[str, str, pd.DataFrame]] = []
        try:
            connection.execute("BEGIN TRANSACTION")
            connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(table_name)}")
            connection.execute(
                f"CREATE TABLE {_quote_identifier(table_name)} AS SELECT * FROM analytica_import_frame"
            )
            if file_frames is not None and len(file_frames) == len(files):
                for index, file_frame in enumerate(file_frames):
                    file_id = str(files[index].get("fileId") or uuid4().hex)
                    files[index]["fileId"] = file_id
                    file_table_name = build_dataset_file_table_name(dataset_id, file_id)
                    files[index]["tableName"] = file_table_name
                    files[index]["rowCount"] = int(len(file_frame.index))
                    register_name = f"analytica_file_frame_{index}"
                    connection.register(register_name, file_frame)
                    registered_file_frames.append((register_name, file_table_name, file_frame))
                    connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(file_table_name)}")
                    connection.execute(
                        f"CREATE TABLE {_quote_identifier(file_table_name)} AS SELECT * FROM {register_name}"
                    )
            connection.execute("DELETE FROM dataset_columns WHERE dataset_id = ?", [dataset_id])
            connection.execute("DELETE FROM dataset_files WHERE dataset_id = ?", [dataset_id])
            connection.execute("DELETE FROM datasets WHERE dataset_id = ?", [dataset_id])
            connection.execute(
                f"""
                INSERT INTO datasets (
                    dataset_id,
                    table_name,
                    dataset_type,
                    row_count,
                    column_count,
                    dataset_size,
                    has_headers
                )
                VALUES (?, ?, ?, ?, ?, ?, {_duckdb_bool_literal(has_headers)})
                """,
                [
                    dataset_id,
                    table_name,
                    dataset_type,
                    int(len(frame.index)),
                    int(len(frame.columns)),
                    int(dataset_size),
                ],
            )
            connection.execute(
                f"UPDATE datasets SET has_headers = {_duckdb_bool_literal(has_headers)} WHERE dataset_id = ?",
                [dataset_id],
            )
            connection.executemany(
                """
                INSERT INTO dataset_files (
                    dataset_id,
                    file_name,
                    file_size,
                    status,
                    file_id,
                    table_name,
                    row_count,
                    imported_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    [
                        dataset_id,
                        file["name"],
                        int(file["size"]),
                        file["status"],
                        file.get("fileId"),
                        file.get("tableName"),
                        int(file.get("rowCount", 0)),
                    ]
                    for file in files
                ],
            )
            connection.executemany(
                """
                INSERT INTO dataset_columns (
                    dataset_id,
                    column_name,
                    column_order,
                    detected_type,
                    nullable,
                    example_value
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    [
                        dataset_id,
                        column["name"],
                        index,
                        column["type"],
                        bool(column["nullable"]),
                        None if column["exampleValue"] is None else str(column["exampleValue"]),
                    ]
                    for index, column in enumerate(schema)
                ],
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
        finally:
            connection.unregister("analytica_import_frame")
            for register_name, _, _ in registered_file_frames:
                connection.unregister(register_name)

    return table_name


def append_dataset_files(
    dataset_id: str,
    frames: list[pd.DataFrame],
    files: list[dict[str, Any]],
    dataset_size_delta: int,
) -> None:
    initialise_dataset_storage()
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        return

    table_name = str(storage_info["tableName"])
    registered_frames: list[str] = []

    for connection in get_connection():
        try:
            connection.execute("BEGIN TRANSACTION")
            for index, frame in enumerate(frames):
                file_id = str(files[index].get("fileId") or uuid4().hex)
                file_table_name = build_dataset_file_table_name(dataset_id, file_id)
                register_name = f"analytica_append_frame_{index}"
                files[index]["fileId"] = file_id
                files[index]["tableName"] = file_table_name
                files[index]["rowCount"] = int(len(frame.index))
                connection.register(register_name, frame)
                registered_frames.append(register_name)
                connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(file_table_name)}")
                connection.execute(
                    f"CREATE TABLE {_quote_identifier(file_table_name)} AS SELECT * FROM {register_name}"
                )
                connection.execute(
                    f"INSERT INTO {_quote_identifier(table_name)} SELECT * FROM {register_name}"
                )
                connection.execute(
                    """
                    INSERT INTO dataset_files (
                        dataset_id,
                        file_name,
                        file_size,
                        status,
                        file_id,
                        table_name,
                        row_count,
                        imported_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    [
                        dataset_id,
                        files[index]["name"],
                        int(files[index]["size"]),
                        files[index]["status"],
                        file_id,
                        file_table_name,
                        int(files[index]["rowCount"]),
                    ],
                )

            row_count = connection.execute(f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}").fetchone()[0]
            connection.execute(
                """
                UPDATE datasets
                SET row_count = ?, dataset_size = dataset_size + ?
                WHERE dataset_id = ?
                """,
                [int(row_count), int(dataset_size_delta), dataset_id],
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
        finally:
            for register_name in registered_frames:
                connection.unregister(register_name)


def finalise_dataset_schema(
    dataset_id: str,
    column_names: list[str],
    has_headers: bool,
) -> None:
    initialise_dataset_storage()
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        return

    existing_columns = [str(column["name"]) for column in storage_info["columns"]]
    validated_column_names = _validate_canonical_column_names(column_names, len(existing_columns))
    resolved_has_headers = _coerce_bool(has_headers)
    table_names = [str(storage_info["tableName"])] + [
        str(file["tableName"])
        for file in _dataset_file_table_rows(dataset_id)
        if file["tableName"] is not None
    ]

    for connection in get_connection():
        try:
            connection.execute("BEGIN TRANSACTION")
            temporary_names = [f"__analytica_column_{index}_{uuid4().hex[:8]}" for index in range(len(existing_columns))]
            for table_name in table_names:
                for index, existing_name in enumerate(existing_columns):
                    connection.execute(
                        f"ALTER TABLE {_quote_identifier(table_name)} "
                        f"RENAME COLUMN {_quote_identifier(existing_name)} TO {_quote_identifier(temporary_names[index])}"
                    )
                for index, temporary_name in enumerate(temporary_names):
                    connection.execute(
                        f"ALTER TABLE {_quote_identifier(table_name)} "
                        f"RENAME COLUMN {_quote_identifier(temporary_name)} TO {_quote_identifier(validated_column_names[index])}"
                    )

            for index, column_name in enumerate(validated_column_names):
                connection.execute(
                    """
                    UPDATE dataset_columns
                    SET column_name = ?
                    WHERE dataset_id = ? AND column_order = ?
                    """,
                    [column_name, dataset_id, index],
                )

            connection.execute(
                f"UPDATE datasets SET has_headers = {_duckdb_bool_literal(resolved_has_headers)} WHERE dataset_id = ?",
                [dataset_id],
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise


def delete_dataset_file(dataset_id: str, file_id: str) -> None:
    initialise_dataset_storage()
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        return

    table_name = str(storage_info["tableName"])

    for connection in get_connection():
        file_row = connection.execute(
            """
            SELECT file_name, file_size, table_name, row_count
            FROM dataset_files
            WHERE dataset_id = ? AND COALESCE(file_id, file_name) = ?
            """,
            [dataset_id, file_id],
        ).fetchone()
        if file_row is None:
            return

        file_name, file_size, file_table_name, stored_row_count = file_row
        if file_table_name is None:
            file_count = connection.execute(
                "SELECT COUNT(*) FROM dataset_files WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()[0]
            if int(stored_row_count or 0) == 0 and int(file_count or 0) > 1:
                connection.execute("BEGIN TRANSACTION")
                try:
                    connection.execute(
                        "DELETE FROM dataset_files WHERE dataset_id = ? AND COALESCE(file_id, file_name) = ?",
                        [dataset_id, file_id],
                    )
                    connection.execute(
                        """
                        UPDATE datasets
                        SET dataset_size = GREATEST(dataset_size - ?, 0)
                        WHERE dataset_id = ?
                        """,
                        [int(file_size or 0), dataset_id],
                    )
                    connection.execute("COMMIT")
                    return
                except Exception:
                    connection.execute("ROLLBACK")
                    raise
            raise ValueError(f"{file_name} cannot be removed because row-level file storage is not available.")

        remaining_file_tables = [
            str(row[0])
            for row in connection.execute(
                """
                SELECT table_name
                FROM dataset_files
                WHERE dataset_id = ?
                  AND COALESCE(file_id, file_name) <> ?
                  AND table_name IS NOT NULL
                ORDER BY imported_at, file_name
                """,
                [dataset_id, file_id],
            ).fetchall()
        ]
        legacy_remaining_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM dataset_files
            WHERE dataset_id = ?
              AND COALESCE(file_id, file_name) <> ?
              AND table_name IS NULL
            """,
            [dataset_id, file_id],
        ).fetchone()[0]

        temp_table_name = f"{table_name}_rebuild_{uuid4().hex[:8]}"
        try:
            connection.execute("BEGIN TRANSACTION")
            if int(legacy_remaining_count or 0) > 0:
                connection.execute(
                    f"CREATE TABLE {_quote_identifier(temp_table_name)} AS "
                    f"SELECT * FROM {_quote_identifier(table_name)} "
                    f"EXCEPT ALL SELECT * FROM {_quote_identifier(str(file_table_name))}"
                )
            elif remaining_file_tables:
                union_sql = " UNION ALL ".join(
                    f"SELECT * FROM {_quote_identifier(file_table)}" for file_table in remaining_file_tables
                )
                connection.execute(f"CREATE TABLE {_quote_identifier(temp_table_name)} AS {union_sql}")
            else:
                connection.execute(
                    f"CREATE TABLE {_quote_identifier(temp_table_name)} AS "
                    f"SELECT * FROM {_quote_identifier(table_name)} WHERE FALSE"
                )

            connection.execute("DELETE FROM dataset_files WHERE dataset_id = ? AND COALESCE(file_id, file_name) = ?", [dataset_id, file_id])
            connection.execute(f"DROP TABLE {_quote_identifier(table_name)}")
            connection.execute(f"ALTER TABLE {_quote_identifier(temp_table_name)} RENAME TO {_quote_identifier(table_name)}")
            connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(str(file_table_name))}")

            row_count = connection.execute(f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}").fetchone()[0]
            connection.execute(
                """
                UPDATE datasets
                SET row_count = ?, dataset_size = GREATEST(dataset_size - ?, 0)
                WHERE dataset_id = ?
                """,
                [int(row_count), int(file_size or 0), dataset_id],
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(temp_table_name)}")
            raise


def load_dataset(dataset_id: str) -> tuple[pd.DataFrame, str, list[dict[str, Any]]] | None:
    initialise_dataset_storage()

    for connection in get_connection():
        dataset_row = connection.execute(
            "SELECT table_name, dataset_type FROM datasets WHERE dataset_id = ?",
            [dataset_id],
        ).fetchone()
        if dataset_row is None:
            return None

        table_name, dataset_type = dataset_row
        _repair_dataset_file_row_counts(connection, dataset_id, str(table_name))
        frame = connection.execute(f"SELECT * FROM {_quote_identifier(str(table_name))}").fetchdf()
        files = [
            {
                "id": str(row[1] or row[0]),
                "name": str(row[0]),
                "size": int(row[2]),
                "status": str(row[3]),
                "rowCount": int(row[4] or 0),
                "importedAt": row[5].isoformat() if row[5] is not None else None,
            }
            for row in connection.execute(
                """
                SELECT file_name, COALESCE(file_id, file_name), file_size, status, row_count, imported_at
                FROM dataset_files
                WHERE dataset_id = ?
                ORDER BY imported_at DESC, CASE WHEN row_count > 0 THEN 0 ELSE 1 END, file_name
                """,
                [dataset_id],
            ).fetchall()
        ]
        return frame, str(dataset_type), files

    return None


def get_dataset_storage_info(dataset_id: str) -> dict[str, Any] | None:
    initialise_dataset_storage()

    for connection in get_connection():
        dataset_row = connection.execute(
            """
            SELECT dataset_id, table_name, dataset_type, row_count, column_count, dataset_size, has_headers
            FROM datasets
            WHERE dataset_id = ?
            """,
            [dataset_id],
        ).fetchone()
        if dataset_row is None:
            return None

        _repair_dataset_file_row_counts(connection, dataset_id, str(dataset_row[1]))
        files = [
            {
                "id": str(row[1] or row[0]),
                "name": str(row[0]),
                "size": int(row[2]),
                "status": str(row[3]),
                "rowCount": int(row[4] or 0),
                "importedAt": row[5].isoformat() if row[5] is not None else None,
            }
            for row in connection.execute(
                """
                SELECT file_name, COALESCE(file_id, file_name), file_size, status, row_count, imported_at
                FROM dataset_files
                WHERE dataset_id = ?
                ORDER BY imported_at DESC, CASE WHEN row_count > 0 THEN 0 ELSE 1 END, file_name
                """,
                [dataset_id],
            ).fetchall()
        ]
        columns = [
            {
                "name": str(row[0]),
                "type": str(row[1]),
                "nullable": bool(row[2]),
                "exampleValue": row[3],
            }
            for row in connection.execute(
                """
                SELECT column_name, detected_type, nullable, example_value
                FROM dataset_columns
                WHERE dataset_id = ?
                ORDER BY column_order
                """,
                [dataset_id],
            ).fetchall()
        ]

        return {
            "datasetId": str(dataset_row[0]),
            "tableName": str(dataset_row[1]),
            "datasetType": str(dataset_row[2]),
            "rowCount": int(dataset_row[3]),
            "columnCount": int(dataset_row[4]),
            "datasetSize": int(dataset_row[5]),
            "hasHeaders": bool(dataset_row[6]) if len(dataset_row) > 6 else True,
            "files": files,
            "columns": columns,
        }

    return None


def build_dataset_table_name(dataset_id: str) -> str:
    safe_dataset_id = "".join(character for character in dataset_id.lower() if character.isalnum() or character == "_")
    return f"{DATASET_TABLE_PREFIX}{safe_dataset_id}"


def build_dataset_file_table_name(dataset_id: str, file_id: str) -> str:
    safe_dataset_id = "".join(character for character in dataset_id.lower() if character.isalnum() or character == "_")
    safe_file_id = "".join(character for character in file_id.lower() if character.isalnum() or character == "_")
    return f"{DATASET_TABLE_PREFIX}{safe_dataset_id}_file_{safe_file_id}"


def _dataset_file_table_rows(dataset_id: str) -> list[dict[str, Any]]:
    for connection in get_connection():
        return [
            {"tableName": row[0]}
            for row in connection.execute(
                """
                SELECT table_name
                FROM dataset_files
                WHERE dataset_id = ? AND table_name IS NOT NULL
                ORDER BY imported_at, file_name
                """,
                [dataset_id],
            ).fetchall()
        ]

    return []


def _validate_canonical_column_names(column_names: list[str], expected_count: int) -> list[str]:
    cleaned_names = [str(column_name).strip() for column_name in column_names]
    if len(cleaned_names) != expected_count:
        raise ValueError(f"Expected {expected_count} column names, got {len(cleaned_names)}.")
    if any(not column_name for column_name in cleaned_names):
        raise ValueError("Every column must have a name.")
    too_long = [column_name for column_name in cleaned_names if len(column_name) > 120]
    if too_long:
        raise ValueError(f"Column names are too long: {', '.join(too_long[:3])}.")

    normalised_names = [column_name.lower() for column_name in cleaned_names]
    duplicates = sorted({name for name in normalised_names if normalised_names.count(name) > 1})
    if duplicates:
        raise ValueError(f"Duplicate column names are not allowed: {', '.join(duplicates)}.")

    return cleaned_names


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no", "off", ""}
    return bool(value)


def _duckdb_bool_literal(value: Any) -> str:
    return "TRUE" if _coerce_bool(value) else "FALSE"


def quote_identifier(identifier: str) -> str:
    return _quote_identifier(identifier)


def _quote_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'


def _ensure_dataset_file_columns(connection: Any) -> None:
    _add_column_if_missing(connection, "dataset_files", "file_id", "VARCHAR")
    _add_column_if_missing(connection, "dataset_files", "table_name", "VARCHAR")
    _add_column_if_missing(connection, "dataset_files", "row_count", "BIGINT DEFAULT 0")
    _add_column_if_missing(connection, "dataset_files", "imported_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")


def _add_column_if_missing(connection: Any, table_name: str, column_name: str, column_definition: str) -> None:
    if _column_exists(connection, table_name, column_name):
        return
    connection.execute(
        f"ALTER TABLE {_quote_identifier(table_name)} "
        f"ADD COLUMN {_quote_identifier(column_name)} {column_definition}"
    )


def _column_exists(connection: Any, table_name: str, column_name: str) -> bool:
    rows = connection.execute(f"DESCRIBE {_quote_identifier(table_name)}").fetchall()
    return any(str(row[0]).lower() == column_name.lower() for row in rows)


def _repair_dataset_file_row_counts(connection: Any, dataset_id: str, table_name: str) -> None:
    rows = connection.execute(
        """
        SELECT COALESCE(file_id, file_name), table_name, row_count
        FROM dataset_files
        WHERE dataset_id = ?
        """,
        [dataset_id],
    ).fetchall()
    if not rows:
        return

    repaired_total = 0
    unresolved_zero_file_ids: list[str] = []

    for file_id, file_table_name, row_count in rows:
        stored_row_count = int(row_count or 0)
        if file_table_name is not None:
            actual_row_count = connection.execute(
                f"SELECT COUNT(*) FROM {_quote_identifier(str(file_table_name))}"
            ).fetchone()[0]
            repaired_total += int(actual_row_count or 0)
            if stored_row_count != int(actual_row_count or 0):
                connection.execute(
                    """
                    UPDATE dataset_files
                    SET row_count = ?
                    WHERE dataset_id = ? AND COALESCE(file_id, file_name) = ?
                    """,
                    [int(actual_row_count or 0), dataset_id, str(file_id)],
                )
            continue

        if stored_row_count > 0:
            repaired_total += stored_row_count
        else:
            unresolved_zero_file_ids.append(str(file_id))

    if not unresolved_zero_file_ids:
        return

    dataset_row_count = connection.execute(
        f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}"
    ).fetchone()[0]
    remaining_rows = max(int(dataset_row_count or 0) - repaired_total, 0)

    if len(unresolved_zero_file_ids) == 1:
        connection.execute(
            """
            UPDATE dataset_files
            SET row_count = ?
            WHERE dataset_id = ? AND COALESCE(file_id, file_name) = ?
            """,
            [remaining_rows, dataset_id, unresolved_zero_file_ids[0]],
        )
