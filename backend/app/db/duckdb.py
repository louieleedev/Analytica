from collections.abc import Iterator
from pathlib import Path

import duckdb

from app.core.config import settings


def get_connection() -> Iterator[duckdb.DuckDBPyConnection]:
    database_path = Path(settings.duckdb_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)

    connection = duckdb.connect(str(database_path))
    try:
        yield connection
    finally:
        connection.close()
