from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.db.duckdb import get_connection
from app.services.dataset_storage import finalise_dataset_schema, initialise_dataset_storage


logger = logging.getLogger(__name__)


def initialise_project_storage() -> None:
    initialise_dataset_storage()

    for connection in get_connection():
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                project_id VARCHAR PRIMARY KEY,
                name VARCHAR NOT NULL,
                description VARCHAR NOT NULL,
                status VARCHAR NOT NULL,
                state VARCHAR NOT NULL,
                dataset_id VARCHAR,
                has_headers BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
            )
            """
        )
        _add_column_if_missing(connection, "projects", "has_headers", "BOOLEAN DEFAULT TRUE")


def create_project_record(
    name: str,
    description: str,
    dataset_id: str | None,
    has_headers: bool = True,
    schema_columns: list[str] | None = None,
) -> dict[str, Any]:
    initialise_project_storage()
    _ensure_project_text(name, description)
    project_id = uuid4().hex
    resolved_has_headers = _coerce_bool(has_headers)

    for connection in get_connection():
        _ensure_unique_project_name(connection, name)
        if dataset_id is not None:
            _ensure_dataset_exists(connection, dataset_id)

    if dataset_id is not None and schema_columns:
        try:
            finalise_dataset_schema(dataset_id, schema_columns, resolved_has_headers)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    for connection in get_connection():
        _ensure_unique_project_name(connection, name)
        connection.execute(
            f"""
            INSERT INTO projects (
                project_id,
                name,
                description,
                status,
                state,
                dataset_id,
                has_headers
            )
            VALUES (?, ?, ?, ?, ?, ?, {_duckdb_bool_literal(resolved_has_headers)})
            """,
            [project_id, name, description, "Healthy", "Active", dataset_id],
        )
        connection.execute(
            f"UPDATE projects SET has_headers = {_duckdb_bool_literal(resolved_has_headers)} WHERE project_id = ?",
            [project_id],
        )

    return get_project_record(project_id)


def list_project_records() -> list[dict[str, Any]]:
    initialise_project_storage()

    try:
        for connection in get_connection():
            rows = connection.execute(
                """
                SELECT
                    p.project_id,
                    p.name,
                    p.description,
                    p.status,
                    p.state,
                    p.dataset_id,
                    p.created_at,
                    p.updated_at,
                    p.has_headers,
                    d.dataset_type,
                    d.row_count,
                    d.column_count,
                    d.dataset_size,
                    COALESCE(f.file_count, 0) AS file_count
                FROM projects p
                LEFT JOIN datasets d ON d.dataset_id = p.dataset_id
                LEFT JOIN (
                    SELECT dataset_id, COUNT(*) AS file_count
                    FROM dataset_files
                    GROUP BY dataset_id
                ) f ON f.dataset_id = p.dataset_id
                ORDER BY p.created_at DESC
                """
            ).fetchall()

            logger.info("Projects loaded from DuckDB: count=%s", len(rows))
            return [_serialise_project(row) for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Project loading failed: error=%s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Projects could not be loaded from DuckDB: {exc}",
        ) from exc

    raise HTTPException(status_code=503, detail="Projects could not be loaded from DuckDB.")


def get_project_record(project_id: str) -> dict[str, Any]:
    initialise_project_storage()

    for connection in get_connection():
        row = connection.execute(
            """
            SELECT
                p.project_id,
                p.name,
                p.description,
                p.status,
                p.state,
                p.dataset_id,
                p.created_at,
                    p.updated_at,
                    p.has_headers,
                    d.dataset_type,
                d.row_count,
                d.column_count,
                d.dataset_size,
                COALESCE(f.file_count, 0) AS file_count
            FROM projects p
            LEFT JOIN datasets d ON d.dataset_id = p.dataset_id
            LEFT JOIN (
                SELECT dataset_id, COUNT(*) AS file_count
                FROM dataset_files
                GROUP BY dataset_id
            ) f ON f.dataset_id = p.dataset_id
            WHERE p.project_id = ?
            """,
            [project_id],
        ).fetchone()

        if row is None:
            raise HTTPException(status_code=404, detail=f"Project {project_id} was not found.")

        return _serialise_project(row)

    raise HTTPException(status_code=404, detail=f"Project {project_id} was not found.")


def update_project_record(project_id: str, name: str | None, description: str | None) -> dict[str, Any]:
    initialise_project_storage()
    if name is not None and not name.strip():
        raise HTTPException(status_code=400, detail="Project name is required.")
    if description is not None and not description.strip():
        raise HTTPException(status_code=400, detail="Project description is required.")

    for connection in get_connection():
        existing = connection.execute(
            "SELECT project_id FROM projects WHERE project_id = ?",
            [project_id],
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail=f"Project {project_id} was not found.")

        if name is not None:
            _ensure_unique_project_name(connection, name, exclude_project_id=project_id)
            connection.execute(
                """
                UPDATE projects
                SET name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ?
                """,
                [name, project_id],
            )

        if description is not None:
            connection.execute(
                """
                UPDATE projects
                SET description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ?
                """,
                [description, project_id],
            )

    return get_project_record(project_id)


def delete_project_record(project_id: str) -> None:
    initialise_project_storage()

    for connection in get_connection():
        existing = connection.execute(
            "SELECT project_id FROM projects WHERE project_id = ?",
            [project_id],
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail=f"Project {project_id} was not found.")

        connection.execute("DELETE FROM projects WHERE project_id = ?", [project_id])


def _ensure_dataset_exists(connection: Any, dataset_id: str) -> None:
    row = connection.execute(
        "SELECT dataset_id FROM datasets WHERE dataset_id = ?",
        [dataset_id],
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=400, detail=f"Dataset {dataset_id} was not found.")


def _ensure_project_text(name: str, description: str) -> None:
    if not name.strip():
        raise HTTPException(status_code=400, detail="Project name is required.")
    if not description.strip():
        raise HTTPException(status_code=400, detail="Project description is required.")


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no", "off", ""}
    return bool(value)


def _duckdb_bool_literal(value: Any) -> str:
    return "TRUE" if _coerce_bool(value) else "FALSE"


def _add_column_if_missing(connection: Any, table_name: str, column_name: str, column_definition: str) -> None:
    if _column_exists(connection, table_name, column_name):
        return
    connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")


def _column_exists(connection: Any, table_name: str, column_name: str) -> bool:
    rows = connection.execute(f"DESCRIBE {table_name}").fetchall()
    return any(str(row[0]).lower() == column_name.lower() for row in rows)


def _ensure_unique_project_name(
    connection: Any,
    name: str,
    exclude_project_id: str | None = None,
) -> None:
    parameters: list[Any] = [name.strip().lower()]
    query = "SELECT project_id FROM projects WHERE lower(name) = ?"

    if exclude_project_id is not None:
        query += " AND project_id <> ?"
        parameters.append(exclude_project_id)

    existing = connection.execute(query, parameters).fetchone()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A project with this name already exists.")


def _serialise_project(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        project_id,
        name,
        description,
        status,
        state,
        dataset_id,
        created_at,
        updated_at,
        has_headers,
        dataset_type,
        row_count,
        column_count,
        dataset_size,
        file_count,
    ) = row

    dataset_metadata = None
    if dataset_id is not None:
        dataset_metadata = {
            "datasetId": str(dataset_id),
            "fileCount": int(file_count or 0),
            "rowCount": int(row_count or 0),
            "columnCount": int(column_count or 0),
            "datasetType": str(dataset_type or ""),
            "datasetSize": int(dataset_size or 0),
            "hasHeaders": bool(has_headers),
        }

    return {
        "id": str(project_id),
        "name": str(name),
        "description": str(description),
        "status": str(status),
        "state": str(state),
        "createdAt": created_at.isoformat() if created_at is not None else None,
        "updatedAt": updated_at.isoformat() if updated_at is not None else None,
        "datasetMetadata": dataset_metadata,
        "hasHeaders": bool(has_headers),
    }
