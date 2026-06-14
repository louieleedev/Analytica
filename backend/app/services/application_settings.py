from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException

from app.db.duckdb import get_connection


DEFAULT_SETTINGS: dict[str, str] = {
    "pivot_max_rows": "100",
    "table_density": "comfort",
}
TABLE_DENSITY_VALUES = {"comfort", "compact", "dense"}


def initialise_application_settings() -> None:
    for connection in get_connection():
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS application_settings (
                setting_key VARCHAR PRIMARY KEY,
                setting_value VARCHAR NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        for setting_key, setting_value in DEFAULT_SETTINGS.items():
            connection.execute(
                """
                INSERT INTO application_settings (setting_key, setting_value, updated_at)
                SELECT ?, ?, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM application_settings
                    WHERE setting_key = ?
                )
                """,
                [setting_key, setting_value, setting_key],
            )


def get_application_settings() -> dict[str, Any]:
    initialise_application_settings()

    for connection in get_connection():
        rows = connection.execute(
            """
            SELECT setting_key, setting_value, updated_at
            FROM application_settings
            ORDER BY setting_key
            """
        ).fetchall()
        return {
            "settings": {
                str(setting_key): _parse_setting_value(str(setting_key), str(setting_value))
                for setting_key, setting_value, _ in rows
            },
            "items": [
                {
                    "key": str(setting_key),
                    "value": _parse_setting_value(str(setting_key), str(setting_value)),
                    "updatedAt": _format_timestamp(updated_at),
                }
                for setting_key, setting_value, updated_at in rows
            ],
        }

    return {"settings": {}, "items": []}


def update_application_settings(settings: dict[str, Any]) -> dict[str, Any]:
    initialise_application_settings()

    allowed_keys = set(DEFAULT_SETTINGS)
    updates = {
        key: _normalise_setting_value(key, value)
        for key, value in settings.items()
        if key in allowed_keys
    }

    for connection in get_connection():
        for setting_key, setting_value in updates.items():
            connection.execute(
                "DELETE FROM application_settings WHERE setting_key = ?",
                [setting_key],
            )
            connection.execute(
                """
                INSERT INTO application_settings (setting_key, setting_value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                """,
                [setting_key, setting_value],
            )

    return get_application_settings()


def _normalise_setting_value(setting_key: str, value: Any) -> str:
    if setting_key == "pivot_max_rows":
        try:
            numeric_value = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="pivot_max_rows must be a number.")

        if numeric_value < 10 or numeric_value > 300:
            raise HTTPException(status_code=400, detail="pivot_max_rows must be between 10 and 300.")

        return str(numeric_value)

    if setting_key == "table_density":
        density = str(value or DEFAULT_SETTINGS[setting_key]).strip().lower()
        if density not in TABLE_DENSITY_VALUES:
            raise HTTPException(status_code=400, detail="table_density must be comfort, compact or dense.")

        return density

    return str(value)


def _parse_setting_value(setting_key: str, value: str) -> int | str:
    if setting_key == "pivot_max_rows":
        try:
            return int(value)
        except ValueError:
            return int(DEFAULT_SETTINGS[setting_key])

    if setting_key == "table_density" and value not in TABLE_DENSITY_VALUES:
        return DEFAULT_SETTINGS[setting_key]

    return value


def _format_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
