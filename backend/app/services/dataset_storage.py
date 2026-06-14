from __future__ import annotations

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
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
) -> str:
    initialise_dataset_storage()
    table_name = build_dataset_table_name(dataset_id)

    for connection in get_connection():
        connection.register("analytica_import_frame", frame)
        try:
            connection.execute("BEGIN TRANSACTION")
            connection.execute(f"DROP TABLE IF EXISTS {_quote_identifier(table_name)}")
            connection.execute(
                f"CREATE TABLE {_quote_identifier(table_name)} AS SELECT * FROM analytica_import_frame"
            )
            connection.execute("DELETE FROM dataset_columns WHERE dataset_id = ?", [dataset_id])
            connection.execute("DELETE FROM dataset_files WHERE dataset_id = ?", [dataset_id])
            connection.execute("DELETE FROM datasets WHERE dataset_id = ?", [dataset_id])
            connection.execute(
                """
                INSERT INTO datasets (
                    dataset_id,
                    table_name,
                    dataset_type,
                    row_count,
                    column_count,
                    dataset_size
                )
                VALUES (?, ?, ?, ?, ?, ?)
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
            connection.executemany(
                """
                INSERT INTO dataset_files (dataset_id, file_name, file_size, status)
                VALUES (?, ?, ?, ?)
                """,
                [
                    [dataset_id, file["name"], int(file["size"]), file["status"]]
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

    return table_name


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
        frame = connection.execute(f"SELECT * FROM {_quote_identifier(str(table_name))}").fetchdf()
        files = [
            {
                "name": str(row[0]),
                "size": int(row[1]),
                "status": str(row[2]),
            }
            for row in connection.execute(
                """
                SELECT file_name, file_size, status
                FROM dataset_files
                WHERE dataset_id = ?
                ORDER BY file_name
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
            SELECT dataset_id, table_name, dataset_type, row_count, column_count, dataset_size
            FROM datasets
            WHERE dataset_id = ?
            """,
            [dataset_id],
        ).fetchone()
        if dataset_row is None:
            return None

        files = [
            {
                "name": str(row[0]),
                "size": int(row[1]),
                "status": str(row[2]),
            }
            for row in connection.execute(
                """
                SELECT file_name, file_size, status
                FROM dataset_files
                WHERE dataset_id = ?
                ORDER BY file_name
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
            "files": files,
            "columns": columns,
        }

    return None


def build_dataset_table_name(dataset_id: str) -> str:
    safe_dataset_id = "".join(character for character in dataset_id.lower() if character.isalnum() or character == "_")
    return f"{DATASET_TABLE_PREFIX}{safe_dataset_id}"


def quote_identifier(identifier: str) -> str:
    return _quote_identifier(identifier)


def _quote_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'
