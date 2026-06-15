from collections.abc import Iterator
import atexit
import logging
from pathlib import Path
from threading import RLock
from typing import Any

import duckdb
from fastapi import HTTPException

from app.core.config import settings


logger = logging.getLogger(__name__)

_CONNECTION: duckdb.DuckDBPyConnection | None = None
_CONNECTION_LOCK = RLock()
_CONNECTION_CREATION_COUNT = 0
_CONNECTION_CLOSE_COUNT = 0
_DATABASE_PATH: Path | None = None


def get_connection() -> Iterator[duckdb.DuckDBPyConnection]:
    _CONNECTION_LOCK.acquire()
    try:
        yield _get_or_create_connection()
    finally:
        _CONNECTION_LOCK.release()


def close_connection() -> None:
    global _CONNECTION, _CONNECTION_CLOSE_COUNT

    with _CONNECTION_LOCK:
        if _CONNECTION is None:
            return

        _CONNECTION.close()
        _CONNECTION = None
        _CONNECTION_CLOSE_COUNT += 1
        logger.info(
            "DuckDB connection closed: path=%s creation_count=%s close_count=%s",
            resolve_database_path(),
            _CONNECTION_CREATION_COUNT,
            _CONNECTION_CLOSE_COUNT,
        )


def resolve_database_path() -> Path:
    configured_path = Path(settings.duckdb_path)
    if configured_path.is_absolute():
        return configured_path

    backend_root = Path(__file__).resolve().parents[2]
    return backend_root / configured_path


def get_duckdb_diagnostics() -> dict[str, Any]:
    database_path = resolve_database_path()
    project_count: int | None = None
    dataset_count: int | None = None

    for connection in get_connection():
        project_count = _safe_count(connection, "projects")
        dataset_count = _safe_count(connection, "datasets")

    return {
        "databasePath": str(database_path),
        "databaseExists": database_path.exists(),
        "connectionIsOpen": _CONNECTION is not None,
        "connectionCreationCount": _CONNECTION_CREATION_COUNT,
        "connectionCloseCount": _CONNECTION_CLOSE_COUNT,
        "projectCount": project_count,
        "datasetCount": dataset_count,
    }


def log_duckdb_diagnostics(context: str) -> None:
    try:
        diagnostics = get_duckdb_diagnostics()
    except Exception:
        logger.exception("DuckDB diagnostics failed: context=%s path=%s", context, resolve_database_path())
        return

    logger.info(
        "DuckDB diagnostics: context=%s path=%s projects=%s datasets=%s created=%s closed=%s open=%s",
        context,
        diagnostics["databasePath"],
        diagnostics["projectCount"],
        diagnostics["datasetCount"],
        diagnostics["connectionCreationCount"],
        diagnostics["connectionCloseCount"],
        diagnostics["connectionIsOpen"],
    )


def _get_or_create_connection() -> duckdb.DuckDBPyConnection:
    global _CONNECTION, _CONNECTION_CREATION_COUNT, _DATABASE_PATH

    if _CONNECTION is not None:
        return _CONNECTION

    try:
        database_path = resolve_database_path()
        database_path.parent.mkdir(parents=True, exist_ok=True)
        _CONNECTION = duckdb.connect(str(database_path))
        _DATABASE_PATH = database_path
        _CONNECTION_CREATION_COUNT += 1
        logger.info(
            "DuckDB connection opened: path=%s creation_count=%s close_count=%s",
            database_path,
            _CONNECTION_CREATION_COUNT,
            _CONNECTION_CLOSE_COUNT,
        )
        return _CONNECTION
    except Exception as exc:
        logger.exception("DuckDB connection failed: path=%s error=%s", resolve_database_path(), exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "DuckDB database is temporarily unavailable. "
                f"Path: {resolve_database_path()}. Error: {exc}"
            ),
        ) from exc


def _safe_count(connection: duckdb.DuckDBPyConnection, table_name: str) -> int | None:
    try:
        row = connection.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()
        return int(row[0] or 0) if row else 0
    except Exception:
        return None


atexit.register(close_connection)
